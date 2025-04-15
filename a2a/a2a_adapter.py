AGENT_CARD_OUTPUT_DIR = os.getenv("AGENT_CARD_OUTPUT_DIR", "/a2a/.well-known")
AGENT_CARD_PATH = os.path.join(AGENT_CARD_OUTPUT_DIR, "agent.json")

# Environment variables or defaults
AGENT_NAME = os.getenv("A2A_AGENT_NAME", "Selector Plus Agent Enhanced with Model Context Protocol Toolkit")
AGENT_DESCRIPTION = os.getenv("A2A_AGENT_DESCRIPTION", "LangGraph-based MCP agent for Selector AI and other MCPs.")
AGENT_HOST = os.getenv("A2A_AGENT_HOST", "localhost")
AGENT_PORT = os.getenv("A2A_AGENT_PORT", "10000")

AGENT_URL = f"http://{AGENT_HOST}:{AGENT_PORT}"

# ✅ Use standards-compliant fields
agent_card = {
    "name": AGENT_NAME,
    "description": AGENT_DESCRIPTION,
    "version": "1.0",
    "url": AGENT_URL,
    "capabilities": {
        "a2a": True,
        "tool-use": True,
        "chat": True
    },
    "skills": []  
}

# Populate skills from your discovered tools
for tool in valid_tools:
    skill = {
        "id": tool.name,  
        "name": tool.name,
        "description": tool.description or "No description provided.",
    }

    if hasattr(tool, "args_schema") and tool.args_schema:
        try:
            skill["parameters"] = tool.args_schema.schema()
        except Exception:
            skill["parameters"] = {"type": "object", "properties": {}}

    agent_card["skills"].append(skill)

os.makedirs(AGENT_CARD_OUTPUT_DIR, exist_ok=True)
with open(AGENT_CARD_PATH, "w") as f:
    json.dump(agent_card, f, indent=2)

print(f"✅ A2A agent card written to {AGENT_CARD_PATH}")
print(f"🌐 Agent is reachable at: {AGENT_URL}")
print("DEBUG: Listing contents of AGENT_CARD_OUTPUT_DIR")
print(os.listdir(AGENT_CARD_OUTPUT_DIR))
print("DEBUG: Full absolute path check:", os.path.abspath(AGENT_CARD_PATH))
