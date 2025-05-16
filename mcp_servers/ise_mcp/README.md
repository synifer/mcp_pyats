# ISE MCP Server

## Overview

The ISE MCP Server is a Model Context Protocol (MCP) server designed to dynamically expose Cisco Identity Services Engine (ISE) data as structured, discoverable tools. This server interacts with Cisco ISE REST APIs, enabling easy integration and data retrieval using JSON-RPC calls.

## Features

- Dynamic tool generation for Cisco ISE resources.
- Environment-driven configuration.
- Structured JSON-RPC interface for tool discovery and execution.

## Setup

### Requirements

- Python 3.8 or higher
- Required packages (install with pip):

```bash
pip install requests pydantic python-dotenv
```

### Configuration

Create a `.env` file in the root directory with the following content:

```env
ISE_BASE=https://devnetsandboxise.cisco.com
USERNAME=readonly
PASSWORD=ISEisC00L
```

Ensure you have a `urls.json` file structured as follows:

```json
[
  {"URL": "/ers/config/endpoint?size=100", "Name": "Endpoints"},
  {"URL": "/ers/config/identitygroup?size=100", "Name": "Identity Groups"},
  ...
]
```

## Running the Server

### One-shot Mode

Use the `--oneshot` option to process a single JSON-RPC request:

```bash
python ise_mcp_server.py --oneshot
```

### Persistent Mode

Run the server persistently, continuously listening for JSON-RPC requests from STDIN:

```bash
python ise_mcp_server.py
```

## JSON-RPC Interface

### Initialize

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "id": 1
}
```

### Discover Tools

```json
{
  "jsonrpc": "2.0",
  "method": "tools/discover",
  "id": 2
}
```

### Call a Tool

Example for calling the `endpoints` tool:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "endpoints",
    "arguments": {}
  },
  "id": 3
}
```

## Tool List

The server automatically generates tools based on the entries in the `urls.json` file. Each tool corresponds to an ISE resource endpoint.

## Logging

Logging is configured with standard INFO-level logging. All requests and responses, along with errors, are logged to the console.

## License

Apache 2.0 License
