// drawio-mcp-server/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  CallToolResponseSchema, // Assuming you might need this for type safety
} from "@modelcontextprotocol/sdk/types.js";
import EventEmitter from "node:events";
import uWS from "uWebSockets.js";

// Assuming these imports provide the necessary types and implementations
import { bus_reply_stream, bus_request_stream, Context } from "./types.js"; // Keep your types
import { create_bus, EmitterBus } from "./emitter_bus.js"; // Assuming create_bus returns EmitterBus
import { default_tool } from "./tool.js"; // Keep your default_tool implementation
import { nanoid_id_generator, IdGenerator } from "./nanoid_id_generator.js"; // Assuming IdGenerator type
import { create_logger, McpConsoleLogger } from "./mcp_console_logger.js"; // Assuming McpConsoleLogger type

// Define the tool list (can be moved to a separate file if large)
const tools = [
    {
        name: "get-selected-cell",
        description: "Get the currently selected diagram cell (vertex or edge)",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "add-rectangle",
        description: "Add a labeled rectangle shape to the diagram.",
        inputSchema: {
            type: "object",
            properties: {
                x: { type: "number", default: 100 },
                y: { type: "number", default: 100 },
                width: { type: "number", default: 200 },
                height: { type: "number", default: 100 },
                text: { type: "string", default: "New Cell" },
                style: { type: "string", default: "whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" },
            },
            required: [],
            additionalProperties: false,
        },
    },
    {
        name: "add-edge",
        description: "Create a connector (edge) between two diagram elements.",
        inputSchema: {
            type: "object",
            properties: {
                source_id: { type: "string" },
                target_id: { type: "string" },
                text: { type: "string", default: "" },
                style: { type: "string", default: "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;" },
            },
            required: ["source_id", "target_id"],
            additionalProperties: false,
        },
    },
    {
        name: "delete-cell-by-id",
        description: "Delete a diagram cell (vertex or edge) by its ID.",
        inputSchema: {
            type: "object",
            properties: {
                cell_id: { type: "string" },
            },
            required: ["cell_id"],
            additionalProperties: false,
        },
    },
    {
        name: "get-shape-categories",
        description: "List all available shape categories.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "get-shapes-in-category",
        description: "List all shapes within a specific shape category.",
        inputSchema: {
            type: "object",
            properties: { category_id: { type: "string" } },
            required: ["category_id"],
            additionalProperties: false,
        },
    },
    {
        name: "get-shape-by-name",
        description: "Retrieve a specific shape by name.",
        inputSchema: {
            type: "object",
            properties: { shape_name: { type: "string" } },
            required: ["shape_name"],
            additionalProperties: false,
        },
    },
    {
        name: "add-cell-of-shape",
        description: "Add a new shape-based vertex to the diagram.",
        inputSchema: {
            type: "object",
            properties: {
                shape_name: { type: "string" },
                x: { type: "number", default: 100 },
                y: { type: "number", default: 100 },
                width: { type: "number", default: 200 },
                height: { type: "number", default: 100 },
                text: { type: "string", default: "" },
                style: { type: "string", default: "whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;" },
            },
            required: ["shape_name"],
            additionalProperties: false,
        },
    },
    // Add other tools here...
];


class DrawioMcpServer {
  private server: Server;
  private log: McpConsoleLogger;
  private emitter: EventEmitter;
  private bus: EmitterBus;
  private id_generator: IdGenerator;
  private context: Context;
  private ws_connections: uWS.WebSocket<unknown>[] = [];
  private ws_port: number = 3000; // Make port configurable if needed

  constructor() {
    this.log = create_logger();
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Keep adjusted listener limit

    this.id_generator = nanoid_id_generator();
    // Pass the actual emitter instance to create_bus
    this.bus = create_bus(this.log)(this.emitter);

    // Context object holding shared resources
    this.context = {
      bus: this.bus,
      id_generator: this.id_generator,
      log: this.log,
      emitter: this.emitter, // Provide emitter if needed directly by tools
    };

    // Initialize MCP Server
    this.server = new Server(
      { name: "drawio-mcp", version: "1.0.1" }, // Updated version example
      { capabilities: { tools: {}, resources: {} } } // Define capabilities
    );

    // Centralized error handling for MCP server
    this.server.onerror = (error) => this.log.error('[MCP Error]', error);

    // Setup handlers
    this.setupWebSocketForwarder();
    this.setupMcpHandlers();
    this.setupWebSocketServer();
    this.setupProcessHandlers();
  }

  // Listens for bus events and forwards them to connected WebSocket clients
  private setupWebSocketForwarder(): void {
    const listener = (event: any) => {
      this.log.debug(`[bridge] 📢 Forwarding request via WS to ${this.ws_connections.length} clients:`, event);

      if (this.ws_connections.length === 0) {
        this.log.warn(`[bridge] ⚠️ No WebSocket connections available to forward request ID: ${event?.id ?? 'N/A'}`);
        // Optional: If no WS connection, immediately respond with an error on the bus?
        // This depends on how `bus.request` handles timeouts or lack of listeners.
        // If bus.request hangs indefinitely without a listener, this is a problem.
        // Consider adding a timeout in the CallTool handler or having the bus handle it.
        return;
      }

      const message = JSON.stringify(event);
      // Use a copy of the array in case connections close during iteration
      [...this.ws_connections].forEach((ws, index) => {
        try {
          // Check WebSocket readyState before sending
          if (ws.readyState === 1 /* OPEN */) {
             ws.send(message);
          } else {
              this.log.warn(`[bridge] ⚠️ WS client ${index} not open (state: ${ws.readyState}). Cannot send.`);
              // Optionally remove closed/closing sockets here or rely on 'close' handler
          }
        } catch (e) {
          this.log.error(`[bridge] ❌ Error forwarding request to WS client ${index}:`, e);
          // Consider removing the connection if sending fails persistently
          this.removeWebSocketConnection(ws);
        }
      });
    };

    this.emitter.on(bus_request_stream, listener);
    this.log.info(`[bridge] 🔌 Registered WebSocket forwarder on '${bus_request_stream}'`);
  }

  // Sets up handlers for MCP requests coming via STDIO
  private setupMcpHandlers(): void {
    // Handle ListTools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.log.info("[mcp] 📋 Received ListTools request");
      return { tools }; // Return the defined tools array
    });

    // Handle CallTool request - This is the core bridging point
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      this.log.info(`[mcp] 🔧 Received CallTool request: ${name}`);
      this.log.debug(`[mcp] Tool arguments:`, args);

      // Find the tool definition (optional but good for validation)
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        this.log.error(`[mcp] ❌ Tool not found: ${name}`);
        throw new McpError(ErrorCode.MethodNotFound, `Tool '${name}' not found`);
      }

      // Use the bus to send the request and wait for the reply from the WebSocket bridge.
      // The `default_tool` function now essentially wraps this bus communication.
      // Assuming default_tool uses context.bus.request internally.
      try {
        this.log.debug(`[mcp] ⚙️ Executing tool '${name}' via bus/WebSocket bridge...`);
        // Pass the *specific* context for this request if default_tool needs it,
        // otherwise, `default_tool` can use the shared context if it's designed that way.
        // The key is that default_tool MUST return a Promise that resolves with the
        // result received from the bus_reply_stream.
        const result = await default_tool(name, this.context)(args);

        this.log.info(`[mcp] ✅ Tool execution complete for: ${name}`);
        this.log.debug(`[mcp] Tool result:`, result);

        // Validate or shape the result according to Mcp CallToolResponseSchema if needed
        // For now, assume `result` is already in the correct format { content: [...] }
        return result as CallToolResponseSchema; // Cast for type safety

      } catch (error: any) {
        this.log.error(`[mcp] ❌ Error executing tool '${name}' via bridge:`, error);
        // Map errors from the bridge/tool execution to McpError
        if (error instanceof McpError) {
          throw error;
        }
        // Include more details if available from the error object
        const errorMessage = error?.message || 'Unknown error during tool execution';
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${errorMessage}`);
      }
    });

    this.log.info("[mcp] Registered MCP request handlers (ListTools, CallTool)");
  }

  // Sets up the WebSocket server to listen for connections from the browser extension
  private setupWebSocketServer(): void {
    const app = uWS.App({}); // Create the app

    app.ws("/*", {
      /* Options */
      idleTimeout: 32, // Example: Close idle connections
      maxPayloadLength: 16 * 1024 * 1024, // Example: 16MB limit

      /* Handlers */
      open: (ws) => {
        this.log.info("[ws] 🔗 New WebSocket connection established.");
        this.ws_connections.push(ws);
        this.log.info(`[ws] 📊 Total active connections: ${this.ws_connections.length}`);
      },

      message: (ws, message, isBinary) => {
        try {
          // Assuming messages are JSON strings
          const decoder = new TextDecoder();
          const str = decoder.decode(message);
          const json = JSON.parse(str);

          this.log.debug(`[ws] 📩 Received message from extension:`, json);

          // Emit the received message (expected to be a reply) onto the bus reply stream.
          // The bus logic (inside `emitter_bus.ts`) should route this based on ID
          // to the correct waiting `bus.request` call.
          this.emitter.emit(bus_reply_stream, json);

        } catch (e) {
          this.log.error(`[ws] ❌ Error processing WebSocket message:`, e);
          // Decide if the connection should be closed due to bad messages
          // ws.close();
        }
      },

      close: (ws, code, message) => {
        this.log.info(`[ws] 🔌 WebSocket connection closed (code: ${code})`);
        this.removeWebSocketConnection(ws);
        this.log.info(`[ws] 📊 Total active connections: ${this.ws_connections.length}`);
      },

      drain: (ws) => {
         this.log.debug(`[ws] WebSocket backpressure relieved for client.`);
      },

    }).listen(this.ws_port, (token) => {
      if (token) {
        this.log.info(`🚀 WebSocket server listening on port ${this.ws_port}`);
      } else {
        this.log.error(`❌ Failed to start WebSocket server on port ${this.ws_port}. Port might be in use.`);
        process.exit(1); // Exit if WS server fails to start
      }
    });
  }

  // Helper to remove a WebSocket connection
  private removeWebSocketConnection(ws: uWS.WebSocket<unknown>): void {
      const index = this.ws_connections.indexOf(ws);
      if (index !== -1) {
          this.ws_connections.splice(index, 1);
      }
  }

  // Setup process signal handlers and exception handlers
  private setupProcessHandlers(): void {
      process.on('SIGINT', async () => {
          this.log.warn('[server] SIGINT received, shutting down...');
          await this.server.close(); // Gracefully close MCP connection
          // Add any other cleanup for WebSockets or resources if needed
          this.ws_connections.forEach(ws => ws.close());
          this.log.info('[server] Shutdown complete.');
          process.exit(0);
      });

      process.on('uncaughtException', (err, origin) => {
          this.log.error('[server] 💥 Uncaught Exception:', err);
          this.log.error('[server] Exception origin:', origin);
          // Consider if the server should attempt to recover or exit
          // process.exit(1); // Uncomment to exit on uncaught exceptions
      });

      process.on('unhandledRejection', (reason, promise) => {
          this.log.error('[server] 💥 Unhandled Rejection at:', promise);
          this.log.error('[server] Reason:', reason);
          // Consider if the server should attempt to recover or exit
          // process.exit(1); // Uncomment to exit on unhandled rejections
      });
  }


  // Starts the MCP server connection
  async run(): Promise<void> {
    try {
      this.log.info("[server] 🚀 Starting MCP server connection via STDIO...");
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.log.info("💡 MCP Server connected. Ready for JSON-RPC requests on STDIN/STDOUT.");
      // Note: WebSocket server is already started in the constructor via setupWebSocketServer
    } catch (error) {
      this.log.error("[server] ❌ Failed to connect MCP server transport:", error);
      process.exit(1);
    }
  }
}

// Instantiate and run the server
const server = new DrawioMcpServer();
server.run().catch((err) => {
  // Use the logger if available, otherwise console.error
  const log = server['log'] ?? console; // Access logger if initialized
  log.error("❌ Fatal error during server startup or runtime:", err);
  process.exit(1);
});