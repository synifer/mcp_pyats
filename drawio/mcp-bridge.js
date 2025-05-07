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
    const id     = payload.id   || payload.__event;
    let   method = payload.method;
    let   params = payload.params?.params || payload.params || {};

    if (method === "tools/call") {
      method = params.name;
      const raw = params.arguments || {};

      // 1) JSON‐string under input?
      if (typeof raw.input === "string") {
        try { params = JSON.parse(raw.input) }
        catch { params = {} }
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
        graph.scrollCellToVisible(cell, true);
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

    // …you can add more tool handlers here…
  }

  // 7) Reply helper
  function sendReply(id, result) {
    if (!id || !isConnected) return;
    ws.send(JSON.stringify({ jsonrpc:"2.0", id, result }));
  }
})();
