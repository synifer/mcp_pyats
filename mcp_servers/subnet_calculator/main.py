# subnet_mcp_server.py
import sys
import json
import ipaddress
import argparse
import time

TOOL_NAME = "calculate_subnet"

def calculate_subnet(cidr: str) -> dict:
    try:
        net = ipaddress.ip_network(cidr, strict=False)
        hosts = list(net.hosts())
        return {
            "network_address": str(net.network_address),
            "broadcast_address": str(net.broadcast_address),
            "netmask": str(net.netmask),
            "wildcard_mask": str(net.hostmask),
            "usable_host_range": f"{hosts[0]} - {hosts[-1]}" if hosts else "N/A",
            "number_of_usable_hosts": len(hosts)
        }
    except Exception as e:
        return {"error": str(e)}

def send_response(resp: dict, req_id=None):
    output = {
        "jsonrpc": "2.0",
        "id": req_id,
    }
    if "error" in resp:
        output["error"] = {"message": resp["error"]}
    else:
        output["result"] = resp
    sys.stdout.write(json.dumps(output) + "\n")
    sys.stdout.flush()

def handle_request(req: dict):
    req_id = req.get("id")
    method = req.get("method")

    if method == "tools/discover":
        send_response([
            {
                "name": TOOL_NAME,
                "description": "Calculates network details for a given CIDR (e.g., 192.168.1.0/24).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cidr": {
                            "type": "string",
                            "description": "CIDR block to calculate (e.g., 192.168.1.0/24)"
                        }
                    },
                    "required": ["cidr"]
                }
            }
        ], req_id)

    elif method == "tools/call":
        tool = req.get("params", {}).get("name")
        args = req.get("params", {}).get("arguments", {})
        if tool != TOOL_NAME:
            send_response({"error": f"Tool not found: {tool}"}, req_id)
        else:
            result = calculate_subnet(args.get("cidr", ""))
            send_response(result, req_id)
    else:
        send_response({"error": f"Unknown method: {method}"}, req_id)

def main_loop():
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line:
                time.sleep(0.1)
                continue
            req = json.loads(line)
            handle_request(req)
        except EOFError:
            break
        except Exception as e:
            send_response({"error": str(e)})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--oneshot", action="store_true")
    args = parser.parse_args()

    if args.oneshot:
        line = sys.stdin.readline().strip()
        if line:
            try:
                req = json.loads(line)
                handle_request(req)
            except Exception as e:
                send_response({"error": str(e)})
        else:
            send_response({"error": "Empty input"})
    else:
        main_loop()
