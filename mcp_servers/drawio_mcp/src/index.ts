import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import EventEmitter from "node:events";
import uWS from "uWebSockets.js";
import fs from "fs";
import path from "path";
import {
  bus_reply_stream,
  bus_request_stream,
  Context,
} from "./types.js";
import { create_bus } from "./emitter_bus.js";
import { default_tool } from "./tool.js";
import { nanoid_id_generator } from "./nanoid_id_generator.js";
import { create_logger } from "./mcp_console_logger.js";

const log = create_logger();
const emitter = new EventEmitter();
const bus = create_bus(log)(emitter);
const id_generator = nanoid_id_generator();
const context: Context = { bus, id_generator, log, emitter };

const toolRegistry: Record<string, { description: string; parameters: any }> = {};

function registerTool(name: string, description: string, parameters: any, handler: any) {
  server.tool(name, description, parameters, handler);
  toolRegistry[name] = { description, parameters };
}

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  id: string;
  params?: Record<string, any>;
}

const fastify = Fastify();
fastify.post("/rpc", async (request: FastifyRequest, reply: FastifyReply) => {
  const json = request.body as JsonRpcRequest;
  if (!json || !json.id) return reply.status(400).send({ error: "Missing ID" });

  if (json.method === "tools/list") {
    return reply.send({
      jsonrpc: "2.0",
      id: json.id,
      result: Object.entries(toolRegistry).map(([name, { description, parameters }]) => ({
        name,
        description,
        parameters,
      })),
    });
  }

  if (json.method === "tools/call") {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          jsonrpc: "2.0",
          id: json.id,
          error: { code: -32000, message: "Timeout waiting for tool response" },
        });
      }, 25000);
      emitter.once(bus_reply_stream, (response) => {
        if (response.id === json.id) {
          clearTimeout(timeout);
          resolve(response);
        }
      });
      emitter.emit(bus_request_stream, json);
    });
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        jsonrpc: "2.0",
        id: json.id,
        error: { code: -32001, message: "Unhandled method" },
      });
    }, 5000);
    emitter.once(bus_reply_stream, (response) => {
      if (response.id === json.id) {
        clearTimeout(timeout);
        resolve(response);
      }
    });
    emitter.emit(bus_request_stream, json);
  });
});

fastify.listen({ port: 11434, host: "0.0.0.0" }, () => {
  log.debug("🌐 HTTP POST /rpc listening on 0.0.0.0:11434");
});

const server = new McpServer({
  name: "drawio-mcp-server",
  version: "1.0.0",
  capabilities: { tools: {}, resources: {} },
});

// Tool definitions
registerTool("get-selected-cell", "Get the currently selected diagram cell.", {}, default_tool("get-selected-cell", context));
registerTool("add-rectangle", "Add a labeled rectangle shape.", {
  x: z.number().optional().default(100),
  y: z.number().optional().default(100),
  width: z.number().optional().default(200),
  height: z.number().optional().default(100),
  text: z.string().optional().default("New Cell"),
  style: z.string().optional().default("whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;")
}, default_tool("add-rectangle", context));
registerTool("add-edge", "Create a connector (edge).", {
  source_id: z.string(),
  target_id: z.string(),
  text: z.string().optional().default(""),
  style: z.string().optional().default("edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;")
}, default_tool("add-edge", context));
registerTool("delete-cell-by-id", "Delete a diagram cell.", { cell_id: z.string() }, default_tool("delete-cell-by-id", context));
registerTool("get-shape-categories", "List all shape categories.", {}, default_tool("get-shape-categories", context));
registerTool("get-shapes-in-category", "List shapes in a category.", { category_id: z.string() }, default_tool("get-shapes-in-category", context));
registerTool("get-shape-by-name", "Get shape by name.", { shape_name: z.string() }, default_tool("get-shape-by-name", context));
registerTool(
  "get-all-cells-detailed",
  "Returns all shapes from the current diagram.",
  {}, // no parameters
  default_tool("get-all-cells-detailed", context)
);
registerTool(
  "get-edge-labels",
  "Returns edges from the current diagram.",
  {}, // no parameters
  default_tool("get-edge-labels", context)
);
registerTool("add-cell-of-shape", "Add shape-based vertex.", {
  shape_name: z.string(),
  x: z.number().optional().default(100),
  y: z.number().optional().default(100),
  width: z.number().optional().default(200),
  height: z.number().optional().default(100),
  text: z.string().optional().default(""),
  style: z.string().optional().default("whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;")
}, default_tool("add-cell-of-shape", context));

const conns: uWS.WebSocket<unknown>[] = [];
const ws_handler: uWS.WebSocketBehavior<unknown> = {
  open: (ws) => { log.debug("[ws] 🔗 Connected"); conns.push(ws); },
  close: (ws) => { const i = conns.indexOf(ws); if (i !== -1) conns.splice(i, 1); log.debug("[ws] 🔌 Disconnected"); },
  message: (ws, msg) => {
    try {
      const json = JSON.parse(new TextDecoder().decode(msg));
      log.debug("[ws] 📥 Received:", json);
      if (json.method !== "client-ready") {
        emitter.emit(bus_reply_stream, json);
        if (json.id && json.result) {
          const filePath = path.join("/tmp", `mcp-response-${json.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(json));
          log.debug(`[relay] 📝 Saved ${filePath}`);
        }
      }
    } catch (err) {
      log.debug("[ws] ❌ Invalid JSON:", err);
    }
  },
};

uWS.App().ws("/*", ws_handler).listen(3000, (token) => {
  if (token) log.debug("🚀 WebSocket server listening on 3000");
  else process.exit(1);
});

emitter.on(bus_request_stream, (event: any) => {
  log.debug(`[bridge] 📤 Forwarding via WebSocket`, event);
  conns.forEach((ws) => ws.send(JSON.stringify(event)));
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.debug("✅ Draw.io MCP Server running on STDIO");
  process.stdin.resume();
}

main().catch((err) => {
  log.debug("❌ MCP Fatal:", err);
  process.exit(1);
});
