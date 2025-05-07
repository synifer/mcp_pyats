// tool.ts
import { Context } from "./types.js";
import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { bus_reply_stream } from "./types.js";

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export function default_tool(name: string, context: Context) {
  return async (args: any): Promise<CallToolResult> => {
    const id = generateId();
    const { emitter } = context;
    const { log, bus } = context;

    log.debug(`[default_tool] 🟢 START for tool: ${name} with id ${id}`);
    log.debug(`[default_tool] 📦 Args:`, args);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        log.debug(`[default_tool] ❌ Timeout waiting for reply for ID ${id}`);
        reject(new McpError(ErrorCode.InternalError, `Timeout waiting for tool response for ${name}`));
      }, 30000);

      const handleReply = (response: any) => {
        if (response.id !== id) return;
        clearTimeout(timeout);
        context.emitter.off(bus_reply_stream, handleReply);
        log.debug(`[default_tool] ✅ Reply received for ${id}:`, response);

        if (response.error) {
          reject(new McpError(ErrorCode.InternalError, response.error));
          return;
        }

        resolve({
          content: response.result?.content || [
            { type: "text", text: `Success: Tool ${name} executed` },
          ],
          isError: response.result?.isError || false,
        });
      };

      context.emitter.on(bus_reply_stream, handleReply);

      log.debug(`[default_tool] 🚀 About to send tool request via bus for ${name} with id ${id}`);

      bus.send_to_extension({
        jsonrpc: "2.0",
        id,
        method: name,
        params: args,
      });

      log.debug(`[default_tool] 📤 Tool request sent for ${name} with id ${id}`);
    });
  };
}