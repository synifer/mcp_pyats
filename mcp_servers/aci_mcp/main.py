import sys
import os
import json
import logging
import requests
import asyncio
import threading
import time
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# ------------------- Setup -------------------
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ACIMCPServer")

APIC_URL = os.getenv("APIC_URL")
USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")
URLS_PATH = os.getenv("URLS_PATH", "urls.json")

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}

# ------------------- Auth + GET -------------------
def get_token():
    try:
        response = requests.post(
            f"{APIC_URL}/api/aaaLogin.json",
            json={"aaaUser": {"attributes": {"name": USERNAME, "pwd": PASSWORD}}},
            verify=False
        )
        response.raise_for_status()
        logger.info("✅ Authenticated with APIC")
        return response.cookies
    except Exception as e:
        logger.error(f"❌ Token auth failed: {e}")
        raise

def aci_get(endpoint: str, params: Optional[Dict[str, Any]] = None):
    try:
        url = f"{APIC_URL}{endpoint}"
        cookies = get_token()
        response = requests.get(url, headers=HEADERS, cookies=cookies, params=params, verify=False)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"❌ API error on GET {endpoint}: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}

# ------------------- Tool Setup -------------------
class GroupedInput(BaseModel):
    endpoint: str = Field(..., description="The API endpoint to query")
    query_params: Optional[Dict[str, Any]] = None

class EmptyInput(BaseModel):
    pass

def load_urls(file_path=URLS_PATH) -> List[Dict[str, Any]]:
    with open(file_path, "r") as f:
        raw = json.load(f)

    tools = []
    for entry in raw:
        if "Group" in entry:
            for ep in entry["Endpoints"]:
                ep["Group"] = entry["Group"]
                tools.append(ep)
        else:
            entry["Group"] = "ungrouped"
            tools.append(entry)
    return tools

URLS = load_urls()

TOOLS = {}

# Group by Group name
grouped: Dict[str, List[str]] = {}
ungrouped: List[Dict[str, Any]] = []

for entry in URLS:
    url = entry.get("URL")
    group = entry.get("Group", "ungrouped")
    if not url:
        continue
    if group == "ungrouped":
        ungrouped.append(entry)
    else:
        grouped.setdefault(group, []).append(url)

# Grouped tools
def make_group_tool(endpoints: List[str], group: str):
    def tool_fn(input: Dict[str, Any]) -> Dict[str, Any]:
        ep = input.get("endpoint")
        params = input.get("query_params", {})
        if ep not in endpoints:
            return {"status": "error", "error": f"Invalid endpoint. Choose from: {endpoints}"}
        logger.info(f"📡 [{group}] Querying: {ep}")
        return aci_get(ep, params)
    return tool_fn

for group, endpoint_list in grouped.items():
    tool_name = f"{group.replace(' ', '_').lower()}_get"
    TOOLS[tool_name] = {
        "function": make_group_tool(endpoint_list, group),
        "description": f"Query any ACI endpoint in the '{group}' group ({len(endpoint_list)} endpoints).",
        "input_model": GroupedInput
    }

# Ungrouped tools (fallback)
for entry in ungrouped:
    name = entry.get("Name", entry["URL"]).replace(" ", "_").lower()
    url = entry["URL"]
    TOOLS[name] = {
        "function": (lambda u: lambda _: aci_get(u))(url),
        "description": f"Query ACI endpoint: {name}",
        "input_model": EmptyInput
    }

# ------------------- JSON-RPC Server -------------------
def discover_tools() -> List[Dict[str, Any]]:
    return [
        {
            "name": name,
            "description": tool["description"],
            "parameters": tool["input_model"].schema()
        }
        for name, tool in TOOLS.items()
    ]

def call_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name not in TOOLS:
        return {"error": {"code": -32601, "message": f"Tool not found: {tool_name}"}}
    try:
        model = TOOLS[tool_name]["input_model"](**arguments)
        return TOOLS[tool_name]["function"](model.dict())
    except ValidationError as ve:
        return {"error": {"code": -32602, "message": str(ve)}}
    except Exception as e:
        logger.error(f"Tool execution error: {e}", exc_info=True)
        return {"error": {"code": -32000, "message": str(e)}}

async def process_request(req: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "capabilities": {"tools": {"discover": True, "call": True}},
                "serverInfo": {"name": "ACI MCP Server", "version": "1.0.0"},
            },
        }

    if method in ("tools/discover", "tools/list"):
        return {"jsonrpc": "2.0", "id": req_id, "result": discover_tools()}

    if method == "tools/call":
        tool_name = params.get("name")
        args = params.get("arguments", {})
        result = call_tool(tool_name, args)
        if "error" in result:
            return {"jsonrpc": "2.0", "id": req_id, "error": result["error"]}
        return {"jsonrpc": "2.0", "id": req_id, "result": result}

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}}

def send_response(resp: Dict[str, Any]):
    sys.stdout.write(json.dumps(resp) + "\n")
    sys.stdout.flush()

def monitor_stdin():
    while True:
        try:
            line = sys.stdin.readline()
            if not line.strip():
                time.sleep(0.1)
                continue
            request_data = json.loads(line)
            response = asyncio.run(process_request(request_data))
            if response:
                send_response(response)
        except Exception as e:
            logger.error(f"Unexpected error in STDIN loop: {e}", exc_info=True)

async def run_server_oneshot():
    input_data = sys.stdin.read().strip()
    request = json.loads(input_data)
    response = await process_request(request)
    if response:
        send_response(response)

# ------------------- Entrypoint -------------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--oneshot", action="store_true")
    args = parser.parse_args()

    if args.oneshot:
        asyncio.run(run_server_oneshot())
    else:
        thread = threading.Thread(target=monitor_stdin, daemon=True)
        thread.start()
        while thread.is_alive():
            time.sleep(0.5)
