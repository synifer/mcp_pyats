;(function initMCPBridge() {
  const WS_URL = "ws://host.docker.internal:3000";
  let ws = null, isConnected = false, graph = null;
  const queue = [];

  function log(...args) {
    console.log(`[MCP ${new Date().toLocaleTimeString()}]`, ...args);
  }

  // 1) Hook EditorUi.init as soon as it exists
  function hookEditorUiInit() {
    if (window.EditorUi && !EditorUi.prototype.__mcpHooked) {
      const orig = EditorUi.prototype.init;
      EditorUi.prototype.init = function(...args) {
        orig.apply(this, args);
        if (!graph && this.editor?.graph) {
          graph = this.editor.graph;
          onGraphReady("EditorUi.init");
        }
      };
      EditorUi.prototype.__mcpHooked = true;
      log("🔧 Hooked EditorUi.prototype.init");
    }
    else if (!window.EditorUi) {
      setTimeout(hookEditorUiInit, 200);
    }
  }
  hookEditorUiInit();

  // 2) Poll for editorUi if it loaded before our hook
  function pollEditorUi() {
    if (window.editorUi?.editor?.graph) {
      graph = window.editorUi.editor.graph;
      onGraphReady("polling editorUi");
    } else {
      setTimeout(pollEditorUi, 200);
    }
  }
  pollEditorUi();

  // 3) Once we have the graph
  function onGraphReady(source) {
    log("✅ Graph ready via", source);
    const div = document.querySelector(".geDiagramContainer");
    if (div) {
      div.style.border = "2px dashed lime";
      log("🎯 Bordered .geDiagramContainer");
    }
    flushQueue();
  }

  // 4) WebSocket setup
  function connectWS() {
    ws = new WebSocket(WS_URL);
    log("🔄 Connecting to WS at", WS_URL);

    ws.onopen = () => {
      isConnected = true;
      log("🟢 WS open");
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "client-ready" }));
      setTimeout(flushQueue, 200);
    };

    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method !== "welcome") {
        if (graph) handleMsg(msg);
        else queue.push(msg);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      log("🔴 WS closed, retry in 3s");
      setTimeout(connectWS, 3000);
    };

    ws.onerror = e => {
      console.error("❌ WS error", e);
    };
  }
  connectWS();

  // 5) Flush queued messages
  function flushQueue() {
    if (!graph) return;
    while (queue.length) {
      handleMsg(queue.shift());
    }
  }

  // 6) Handle incoming RPC
  function handleMsg(payload) {
    console.debug("[MCP-BRIDGE] got payload:", payload);
    const id     = payload.id   || payload.__event;
    let   method = payload.method;
    let   params = payload.params?.params || payload.params || {};

    if (method === "tools/call") {
      method = params.name;
      const raw = params.arguments || {};

      // 1) JSON‐string under input?
      if (typeof raw.input === "string") {
        try {
          params = JSON.parse(raw.input);
        } catch (err) {
          // fallback to treating the entire string as your label
          params = { text: raw.input };
        }
      }
      // 2) Legacy __arg1?
      else if (typeof raw.__arg1 === "string") {
        try { params = JSON.parse(raw.__arg1) }
        catch { params = {} }
      }
      // 3) Direct object
      else if (typeof raw === "object") {
        params = raw;
      }

      // Normalize label → text
      if (params.label != null && params.text == null) {
        params.text = params.label;
      }
    }

    // ——— add-rectangle ———
    if (method === "add-rectangle") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });

      const view  = graph.getView(),
            model = graph.getModel();

      // find topmost visible layer
      let parent = graph.getDefaultParent(),
          root   = model.getRoot();
      for (let i = model.getChildCount(root) - 1; i >= 0; i--) {
        const layer = model.getChildAt(root, i);
        if (graph.isCellVisible(layer)) {
          parent = layer;
          break;
        }
      }

      // compute x,y
      const cw = graph.container.clientWidth,
            ch = graph.container.clientHeight;
      const x = params.x != null
              ? graph.snap((params.x / view.scale) - view.translate.x)
              : graph.snap((cw/2 / view.scale) - view.translate.x);
      const y = params.y != null
              ? graph.snap((params.y / view.scale) - view.translate.y)
              : graph.snap((ch/2 / view.scale) - view.translate.y);

      // size, text, style
      const w   = graph.snap(params.width  ?? 120),
            h   = graph.snap(params.height ??  80),
            txt = params.text             ?? "MADE BY MCP",
            sty = params.style
                    ?? (params.color
                         ? `shape=rectangle;fillColor=${params.color};strokeColor=black;strokeWidth=2;`
                         : "shape=rectangle;fillColor=yellow;strokeColor=black;strokeWidth=2;");

      model.beginUpdate();
      try {
        const cell = graph.insertVertex(parent, null, txt, x, y, w, h, sty);
        graph.orderCells(true, [cell]);
        graph.scrollCellToVisible(cell, false);
        graph.setSelectionCell(cell);
        sendReply(id, { success: true, cellId: cell.id });
      } catch (e) {
        sendReply(id, { error: e.message });
      } finally {
        model.endUpdate();
      }
      return;
    }

    // ——— add-edge ———
    if (method === "add-edge") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });

      const view  = graph.getView(),
            model = graph.getModel();

      const src = model.getCell(params.source_id),
            tgt = model.getCell(params.target_id);

      if (!src || !tgt) {
        return sendReply(id, { error: "Source or target cell not found" });
      }

      const parent = graph.getDefaultParent(),
            txt    = params.text  ?? "",
            sty    = params.style 
                    ?? "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;";

      model.beginUpdate();
      try {
        const edge = graph.insertEdge(parent, null, txt, src, tgt, sty);
        graph.orderCells(true, [edge]);
        graph.scrollCellToVisible(edge, true);
        graph.setSelectionCell(edge);
        sendReply(id, { success: true, edgeId: edge.id });
      } catch (e) {
        sendReply(id, { error: e.message });
      } finally {
        model.endUpdate();
      }
      return;
    }

    if (method === "get-selected-cell") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });
    
      const cell = graph.getSelectionCell();
      if (!cell) return sendReply(id, { error: "No cell selected" });
    
      const geometry = cell.geometry || {};
      const result = {
        id: cell.id,
        value: cell.value,
        style: cell.style,
        vertex: cell.vertex,
        edge: cell.edge,
        geometry: {
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height
        },
        parent: cell.parent?.id,
        source: cell.source?.id,
        target: cell.target?.id
      };
    
      return sendReply(id, result);
    }

    if (method === "get-shape-categories") {
      try {
        const palettes = window.editorUi.sidebar?.palettes || {};
        const result = Object.keys(palettes).map(id => {
          const palette = palettes[id];
          return {
            id,
            name: palette?.title || id
          };
        });
      
        return sendReply(id, result);
      } catch (err) {
        return sendReply(id, { error: "Unable to retrieve shape categories" });
      }
    }

    if (method === "add-cell-of-shape") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });
    
      const sidebar = window.editorUi?.sidebar;
      if (!sidebar) return sendReply(id, { error: "Sidebar not available" });
    
      const shapeName = params.shape_name?.toLowerCase();
      const x = params.x ?? 100;
      const y = params.y ?? 100;
      const width = params.width ?? 80;
      const height = params.height ?? 80;
    
      // Loop through all palettes and entries
      const palettes = sidebar.palettes || {};
      let shapeXml = null;
    
      for (const key in palettes) {
        const tempDiv = document.createElement("div");
        palettes[key].showEntries(tempDiv, true);
      
        const shapeNodes = tempDiv.querySelectorAll("a[title]");
        for (const node of shapeNodes) {
          if (node.getAttribute("title")?.toLowerCase() === shapeName) {
            shapeXml = node.getAttribute("data-shape");
            break;
          }
        }
        if (shapeXml) break;
      }
    
      if (!shapeXml) {
        return sendReply(id, { error: `Shape '${shapeName}' not found` });
      }
    
      // Decode XML and insert
      const xmlDoc = mxUtils.parseXml(shapeXml);
      const codec = new mxCodec(xmlDoc);
      const node = xmlDoc.documentElement;
      const cell = codec.decodeCell(node, true);
    
      if (!cell) return sendReply(id, { error: "Failed to decode shape XML" });
    
      const parent = graph.getDefaultParent();
      cell.geometry = new mxGeometry(x, y, width, height);
      cell.geometry.relative = false;
    
      graph.getModel().beginUpdate();
      try {
        const inserted = graph.addCell(cell, parent);
        graph.scrollCellToVisible(inserted);
        graph.setSelectionCell(inserted);
        sendReply(id, { success: true, cellId: inserted.id });
      } catch (e) {
        sendReply(id, { error: e.message });
      } finally {
        graph.getModel().endUpdate();
      }
    
      return;
    }

    if (method === "get-all-cells-detailed") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });
    
      const model = graph.getModel();
      const parent = graph.getDefaultParent();
      const cells = graph.getChildCells(parent, true, true); // includes vertices and edges
    
      const result = cells.map(cell => {
        const geometry = cell.geometry || {};
      
        // Extract visible label text from <div> or XML/HTML structure
        let labelText = null;
      
        try {
          if (typeof cell.value === "object") {
            if (cell.value.innerHTML) {
              labelText = cell.value.innerHTML
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/?[^>]+>/g, "")
                .trim();
            } else if (cell.value.textContent) {
              labelText = cell.value.textContent.trim();
            } else if (cell.value.outerHTML) {
              labelText = cell.value.outerHTML
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/?[^>]+>/g, "")
                .trim();
            }
          } else if (typeof cell.value === "string") {
            labelText = cell.value;
          }
        } catch (e) {
          labelText = null;
        }
      
        // Extract label from style if not already found
        if (!labelText && cell.style) {
          const labelMatch = cell.style.match(/label=([^;]+)/);
          if (labelMatch) {
            try {
              labelText = decodeURIComponent(labelMatch[1]);
            } catch {
              labelText = labelMatch[1];
            }
          }
        }
      
        // Extract raw XML attributes
        let attributes = {};
        if (cell.value && typeof cell.value !== "string" && cell.value.attributes) {
          for (const attr of Array.from(cell.value.attributes)) {
            attributes[attr.name] = attr.value;
          }
        }
      
        // Optional: break labelText into logical lines for LLM use
        const parsedLines = labelText
          ? labelText.split(/\n|\\n/).map(l => l.trim()).filter(Boolean)
          : [];
      
        return {
          id: cell.id,
          type: cell.vertex ? "vertex" : cell.edge ? "edge" : "unknown",
          text: labelText,
          parsedLines,
          rawValue: typeof cell.value === "string" ? cell.value : null,
          attributes,
          style: cell.style,
          geometry: {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height
          },
          vertex: cell.vertex ?? false,
          edge: cell.edge ?? false,
          parent: cell.parent?.id ?? null,
          source: cell.source?.id ?? null,
          target: cell.target?.id ?? null
        };
      });
    
      return sendReply(id, result);
    }
    if (method === "get-edge-labels") {
      if (!graph) return sendReply(id, { error: "Graph not ready" });
    
      try {
        const model = graph.getModel();
        const parent = graph.getDefaultParent();
        const edges = graph.getChildCells(parent, false, true); // just edges
      
        const result = edges.map(edge => {
          let label = null;
        
          // 1. Direct string
          if (typeof edge.value === "string") {
            label = edge.value;
          }
        
          // 2. HTML
          else if (edge.value?.innerHTML) {
            label = edge.value.innerHTML
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/?[^>]+>/g, "")
              .trim();
          }
        
          // 3. XML node
          else if (edge.value?.getAttribute) {
            label =
              edge.value.getAttribute("label") ||
              edge.value.getAttribute("value") ||
              edge.value.textContent?.trim() || null;
          }
        
          // 4. Child labels
          if (!label && edge.children) {
            for (const child of edge.children) {
              if (typeof child.value === "string") {
                label = child.value;
                break;
              } else if (child.value?.textContent) {
                label = child.value.textContent.trim();
                break;
              }
            }
          }
        
          // 5. Style string
          if (!label && edge.style) {
            const match = edge.style.match(/label=([^;]+)/);
            if (match) {
              try {
                label = decodeURIComponent(match[1]);
              } catch {
                label = match[1];
              }
            }
          }
        
          return {
            id: edge.id,
            source: edge.source?.value || edge.source?.id || null,
            target: edge.target?.value || edge.target?.id || null,
            label
          };
        });
      
        return sendReply(id, result);
      } catch (err) {
        console.error("🔥 get-edge-labels failed:", err);
        return sendReply(id, { error: err.message || "Unknown failure" });
      }
    }

  }

  // 7) Reply helper
  function sendReply(id, result) {
    if (!id || !isConnected) return;
    ws.send(JSON.stringify({ jsonrpc:"2.0", id, result }));
  }
})();
