import os
import httpx
import uvicorn
from dotenv import load_dotenv

from .agent_executor import LangGraphAgentExecutor
from a2a.server.apps import A2AStarletteApplication
from a2a.server.tasks import InMemoryTaskStore, InMemoryPushNotifier
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.types import AgentCard, AgentCapabilities, AgentSkill

load_dotenv()

HOST = os.getenv("A2A_HOST", "0.0.0.0")
PORT = int(os.getenv("A2A_PORT", 10000))
PUBLIC_URL = os.getenv("PUBLIC_BASE_URL", f"http://localhost:{PORT}")

def build_agent_card() -> AgentCard:
    return AgentCard(
        name="MCpyATS",
        description="Cisco pyATS LangGraph agent with A2A interface",
        version="1.0.0",
        url=PUBLIC_URL,
        endpoint=PUBLIC_URL,
        defaultInputModes=["text"],   # ✅ REQUIRED
        defaultOutputModes=["text"],  # ✅ REQUIRED
        capabilities=AgentCapabilities(
            a2a=True,
            toolUse=True,
            chat=True,
            streaming=True,
            pushNotifications=True
        ),
        skills=[
            AgentSkill(
                id="mcpyats_query",
                name="Run a LangGraph task",
                description="Run pyATS tasks and more with LangGraph",
                examples=["Check interface status", "Get BGP peers"],
                tags=["pyats", "network automation", "langgraph"]
            )
        ]
    )

def main():
    executor = LangGraphAgentExecutor()
    request_handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
        push_notifier=InMemoryPushNotifier(httpx.AsyncClient()),
    )

    app = A2AStarletteApplication(agent_card=build_agent_card(), http_handler=request_handler)
    uvicorn.run(app.build(), host=HOST, port=PORT)

if __name__ == "__main__":
    main()
