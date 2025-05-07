;(function initMCPBridge() {
  const WS_URL = "ws://host.docker.internal:3000";
  const messageQueue = [];
  let ws = null, isConnected = false, graph = null, isDebug = true;

  function log(...args) {
    console.log(`[MCP ${new Date().toLocaleTimeString()}]`, ...args);
  }
  function debug(...args) {
    if (isDebug) console.debug(`[MCP-DEBUG ${new Date().toLocaleTimeString()}]`, ...args);
  }

  // ——— 1) Patch constructors immediately ———
  (function patchConstructors() {
    const origMx = window.mxGraph;
    if (typeof origMx === "function") {
      window.mxGraph = function(...args) {
        const inst = new origMx(...args);
        if (!graph && inst.container) {
          graph = inst;
          onGraphReady("mxGraph ctor");
        }
        return inst;
      };
      Object.assign(window.mxGraph, origMx);
      window.mxGraph.prototype = origMx.prototype;
      log("🔧 Patched mxGraph constructor");
    }
    // Patch Graph alias if used
    if (window.Graph === origMx && typeof window.mxGraph === "function") {
      window.Graph = window.mxGraph;
      log("🔧 Patched Graph alias");
    }
  })();

  // ——— 2) Hook EditorUi.prototype.init ———
  if (window.EditorUi?.prototype && !window.EditorUi.prototype.__mcpHooked) {
    const origInit = window.EditorUi.prototype.init;
    window.EditorUi.prototype.init = function(...args) {
      origInit.apply(this, args);
      if (!graph && this.editor?.graph) {
        graph = this.editor.graph;
        onGraphReady("EditorUi.init");
      }
    };
    window.EditorUi.prototype.__mcpHooked = true;
    log("🔧 Hooked EditorUi.prototype.init");
  }

  // ——— common ready handler ———
  function onGraphReady(source) {
    log("✅ Graph ready", source, graph);
    const div = document.querySelector(".geDiagramContainer");
    if (div) {
      div.style.border = "2px dashed lime";
      log("🎯 Bordered .geDiagramContainer");
    }
    flushQueue();
  }

  // ——— 3) Poll in case graph existed before our hooks ———
  function startPolling() {
    log("🔍 Polling for existing graph…");
    const pid = setInterval(() => {
      const ui = window.editorUi;
      const g = graph || ui?.editor?.graph;
      if (g) {
        clearInterval(pid);
        graph = g;
        onGraphReady("polling");
      }
    }, 500);

    setTimeout(() => {
      if (!graph) {
        log("⚠️ Still no graph after polling; waiting on ctor or init hooks");
      }
    }, 30000);
  }

  // ——— 4) WebSocket setup ———
  function connectWS() {
    if (ws) try { ws.close() } catch {}
    log("🔄 Connecting to", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      log("🟢 WS open");
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "client-ready" }));
      setTimeout(flushQueue, 500);
    };
    ws.onclose = () => {
      isConnected = false;
      log("🔴 WS closed—reconnect in 3s");
      setTimeout(connectWS, 3000);
    };
    ws.onerror = e => console.error("❌ WS error", e);
    ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data) } catch { return }
      if (msg.method !== "welcome") {
        if (graph) handleMsg(msg);
        else         messageQueue.push(msg);
      }
    };
  }

  // ——— 5) Dispatch & queue ———
  function flushQueue() {
    if (!graph || !messageQueue.length) return;
    log(`📬 Flushing ${messageQueue.length} queued calls`);
    const q = messageQueue.splice(0);
    q.forEach(msg => {
      try { handleMsg(msg) }
      catch (e) { console.error("Queue error", e, msg) }
    });
  }

  // ——— 6) Core tool handler ———
  function handleMsg(payload) {
    debug("🔥 handleMsg:", payload);
    const id = payload.id || payload.__event;
    let method = payload.method;
    let params = (payload.params?.params || payload.params) || {};

    if (method === "tools/call") {
      method = params.name;
      try { params = JSON.parse(params.arguments?.input || "{}") }
      catch { params = params.arguments || {} }
    }

    if (method === "add-rectangle") {
      if (!graph) return reply(id, { error:"Graph not ready" });

      const view = graph.getView(), model = graph.getModel();
      let parent = graph.getDefaultParent();
      const root = model.getRoot();
      for (let i=model.getChildCount(root)-1; i>=0; i--) {
        const layer = model.getChildAt(root,i);
        if (graph.isCellVisible(layer)) { parent = layer; break }
      }

      let x,y;
      if (params.x!=null && params.y!=null) {
        x=graph.snap((params.x/view.scale)-view.translate.x);
        y=graph.snap((params.y/view.scale)-view.translate.y);
      } else {
        const cw=graph.container.clientWidth, ch=graph.container.clientHeight;
        x=graph.snap((cw/2/view.scale)-view.translate.x);
        y=graph.snap((ch/2/view.scale)-view.translate.y);
      }

      const w=graph.snap(params.width ??120),
            h=graph.snap(params.height?? 80),
            txt=params.text??"MADE BY MCP",
            sty=params.style
              ??"shape=rectangle;fillColor=yellow;strokeColor=black;strokeWidth=2;";

      model.beginUpdate();
      try {
        const cell = graph.insertVertex(parent,null,txt,x,y,w,h,sty);
        graph.orderCells(true,[cell]);
        graph.scrollCellToVisible(cell,true);
        graph.setSelectionCell(cell);
        graph.refresh();
        view.invalidate();
        graph.sizeDidChange();
        reply(id,{ success:true, cellId:cell.id });
      }
      catch(e) {
        console.error("❌ Insert error",e);
        reply(id,{ error:e.message });
      }
      finally { model.endUpdate() }
    }
  }

  function reply(id,result) {
    if (!id||!isConnected||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ jsonrpc:"2.0",id,result }));
  }

  // ——— 7) Init everything ———
  function init() {
    log("🚀 Starting MCP Bridge");
    connectWS();
    startPolling();
  }

  init();
  window.restartMcpBridge = init;
  window.mcpBridge = () => ({ connected:isConnected, graphReady:!!graph });
})();
