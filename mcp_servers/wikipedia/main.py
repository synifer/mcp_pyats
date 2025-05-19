import sys
import json
import logging
import asyncio
import argparse
import threading
import time
from pydantic import BaseModel, Field, ValidationError
from typing import Dict, Any, List, Optional
import wikipedia
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("WikipediaMCP")

# ------------------------------- Input Schemas -------------------------------

class WikipediaPageInput(BaseModel):
    page: str = Field(..., description="The title of the Wikipedia page to retrieve.")

class WikipediaSearchInput(BaseModel):
    query: str = Field(..., description="Search term to find Wikipedia pages.")

# ------------------------------- Tool Functions -------------------------------

def tool_wrapper(func, input_model):
    def wrapper(arguments: Dict[str, Any]):
        try:
            validated = input_model(**arguments)
            return func(validated)
        except ValidationError as ve:
            return {"error": {"code": -32602, "message": str(ve)}}
        except Exception as e:
            return {"error": {"code": -32000, "message": str(e)}}
    return wrapper

TOOLS = {
    "get_summary": {
        "function": tool_wrapper(lambda i: {"summary": wikipedia.summary(i.page)}, WikipediaPageInput),
        "description": "Retrieve the summary of a given Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_content": {
        "function": tool_wrapper(lambda i: {"content": wikipedia.page(i.page).content}, WikipediaPageInput),
        "description": "Retrieve the full content of a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_html": {
        "function": tool_wrapper(lambda i: {"html": wikipedia.page(i.page).html()}, WikipediaPageInput),
        "description": "Retrieve rendered HTML of a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_images": {
        "function": tool_wrapper(lambda i: {"images": wikipedia.page(i.page).images}, WikipediaPageInput),
        "description": "Retrieve images from a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_links": {
        "function": tool_wrapper(lambda i: {"links": wikipedia.page(i.page).links}, WikipediaPageInput),
        "description": "Retrieve links from a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_references": {
        "function": tool_wrapper(lambda i: {"references": wikipedia.page(i.page).references}, WikipediaPageInput),
        "description": "Retrieve references from a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_categories": {
        "function": tool_wrapper(lambda i: {"categories": wikipedia.page(i.page).categories}, WikipediaPageInput),
        "description": "Retrieve categories of a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_url": {
        "function": tool_wrapper(lambda i: {"url": wikipedia.page(i.page).url}, WikipediaPageInput),
        "description": "Retrieve the canonical URL of a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_title": {
        "function": tool_wrapper(lambda i: {"title": wikipedia.page(i.page).title}, WikipediaPageInput),
        "description": "Retrieve normalized title of a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
    "get_page_id": {
        "function": tool_wrapper(lambda i: {"page_id": wikipedia.page(i.page).pageid}, WikipediaPageInput),
        "description": "Retrieve internal Wikipedia page ID.",
        "input_model": WikipediaPageInput
    },
    "search_pages": {
        "function": tool_wrapper(lambda i: {"results": wikipedia.search(i.query)}, WikipediaSearchInput),
        "description": "Search for pages on Wikipedia.",
        "input_model": WikipediaSearchInput
    },
    "check_page_exists": {
        "function": tool_wrapper(lambda i: {"exists": wikipedia.page(i.page) is not None}, WikipediaPageInput),
        "description": "Check if a Wikipedia page exists.",
        "input_model": WikipediaPageInput
    },
    "disambiguation_options": {
        "function": tool_wrapper(
            lambda i: {"disambiguation": True, "options": wikipedia.page(i.page).options}
            if hasattr(wikipedia.page(i.page), "options") else {"disambiguation": False, "options": []},
            WikipediaPageInput
        ),
        "description": "Get disambiguation options for a Wikipedia page.",
        "input_model": WikipediaPageInput
    },
}

# ------------------------------- JSON-RPC Handlers -------------------------------

def discover_tools():
    return [
        {
            "name": name,
            "description": tool["description"],
            "parameters": tool["input_model"].schema()
        }
        for name, tool in TOOLS.items()
    ]

def call_tool(name: str, args: Dict[str, Any]) -> Any:
    if name not in TOOLS:
        return {"error": {"code": -32601, "message": f"Tool '{name}' not found"}}
    return TOOLS[name]["function"](args)

async def process_request(request: Dict[str, Any]) -> Dict[str, Any]:
    req_id = request.get("id")
    method = request.get("method")
    params = request.get("params", {})

    if method in ("tools/discover", "tools/list"):
        return {"jsonrpc": "2.0", "id": req_id, "result": discover_tools()}
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        result = call_tool(tool_name, arguments)
        if "error" in result:
            return {"jsonrpc": "2.0", "id": req_id, "error": result["error"]}
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    else:
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
            try:
                request_data = json.loads(line)
                response = asyncio.run(process_request(request_data))
                if response:
                    send_response(response)
            except json.JSONDecodeError as e:
                send_response({"jsonrpc": "2.0", "error": {"code": -32700, "message": str(e)}, "id": None})
        except Exception as e:
            logger.error(f"Unexpected error in STDIO loop: {e}", exc_info=True)

async def run_server_oneshot():
    input_data = sys.stdin.read().strip()
    request = json.loads(input_data)
    response = await process_request(request)
    if response:
        send_response(response)

# ------------------------------- Entry Point -------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--oneshot", action="store_true")
    args = parser.parse_args()

    if args.oneshot:
        asyncio.run(run_server_oneshot())
    else:
        stdin_thread = threading.Thread(target=monitor_stdin, daemon=True)
        stdin_thread.start()
        while stdin_thread.is_alive():
            time.sleep(0.5)
