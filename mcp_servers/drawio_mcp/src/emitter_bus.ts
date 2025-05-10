import EventEmitter from "node:events";
import {
  Bus,
  bus_reply_stream,
  bus_request_stream,
  BusListener,
  Logger,
} from "./types.js";

export function create_bus(log: Logger) {
  return function (emitter: EventEmitter): Bus {
    const bus: Bus = {
      send_to_extension: (request) => {
        log.debug(`[bus] 📤 Sending request to extension:`, request);
        emitter.emit(bus_request_stream, request);
      },
      on_reply_from_extension: (event_name, listener) => {
        log.debug(`[bus] 🔄 Registering listener for event: ${event_name}`);
        const emitter_listener = (data: any) => {
          log.debug(`[bus] 📥 Received reply from extension:`, data);
          if (data) {
            data.__event = event_name;
            listener(data);
          }
        };
        emitter.on(bus_reply_stream, emitter_listener);
      },
    };
    return bus;
  };
}
