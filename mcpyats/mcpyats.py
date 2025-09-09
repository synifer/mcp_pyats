import os
import re
import json
import asyncio
import inspect
import logging
import importlib
import subprocess
from functools import wraps
from dotenv import load_dotenv
from langsmith import traceable
from pydantic import BaseModel, Field
from typing_extensions import TypedDict
from langchain_core.documents import Document
from langchain_core.messages import ToolMessage, BaseMessage
from langchain.tools import Tool, StructuredTool
from langgraph.graph.message import add_messages
from langchain_core.vectorstores import InMemoryVectorStore
from typing import Dict, Any, List, Optional, Union, Annotated
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt.tool_node import tools_condition, ToolNode
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class GraphState(TypedDict):
    """Improved state tracking for LangGraph."""
    messages: Annotated[list[BaseMessage], add_messages]
    selected_tools: Optional[list[str]]  # Tools selected by LLM
    used_tools: list[str]  # Tools already called in this session
    context: dict  # Any additional context
    file_path: Optional[str]
    run_mode: Optional[str]  # "start" or "continue"

def load_local_tools_from_folder(folder_path: str) -> List[Tool]:
    """Loads tools from a local folder."""
    local_tools = []
    for filename in os.listdir(folder_path):
        if filename.endswith(".py") and not filename.startswith("__"):
            module_name = filename[:-3]
            try:
                module = importlib.import_module(f"{folder_path}.{module_name}")
                for name, obj in inspect.getmembers(module):
                    if isinstance(obj, Tool):
                        wrapped = wrap_dict_input_tool(obj)
                        local_tools.append(wrapped)
                        print(f"✅ Loaded local tool: {wrapped.name}")
                    elif isinstance(obj, StructuredTool):
                        local_tools.append(obj)
                        print(f"✅ Loaded structured tool: {obj.name}")
            except Exception as e:
                print(f"❌ Failed to import {module_name}: {e}")
    return local_tools

def wrap_dict_input_tool(tool_obj: Tool) -> Tool:
    """Wraps a tool function to handle string or dict input."""
    original_func = tool_obj.func

    @wraps(original_func)
    def wrapper(input_value):
        if isinstance(input_value, str):
            input_value = {"ip": input_value}
        elif isinstance(input_value, dict) and "ip" not in input_value:
            logger.warning(f"⚠️ Missing 'ip' key in dict: {input_value}")
        return original_func(input_value)

    return Tool(
        name=tool_obj.name,
        description=tool_obj.description,
        func=wrapper,
    )

def schema_to_pydantic_model(name: str, schema: dict):
    """Dynamically creates a Pydantic model class from a JSON Schema."""
    from typing import Any, List, Dict, Optional
    namespace = {"__annotations__": {}}

    if schema.get("type") != "object":
        raise ValueError("Only object schemas are supported.")

    properties = schema.get("properties", {})
    required_fields = set(schema.get("required", []))

    for field_name, field_schema in properties.items():
        json_type = field_schema.get("type", "string")
        is_optional = field_name not in required_fields

        if json_type == "string":
            field_type = str
        elif json_type == "integer":
            field_type = int
        elif json_type == "number":
            field_type = float
        elif json_type == "boolean":
            field_type = bool
        elif json_type == "array":
            items_schema = field_schema.get("items")
            if not items_schema:
                logger.warning(f"⚠️ Skipping field '{field_name}' (array missing 'items')")
                continue  # Skip malformed array field
            item_type = items_schema.get("type", "string")
            if item_type == "string":
                field_type = List[str]
            elif item_type == "integer":
                field_type = List[int]
            elif item_type == "number":
                field_type = List[float]
            elif item_type == "boolean":
                field_type = List[bool]
            elif item_type == "object":
                item_model = schema_to_pydantic_model(name + "_" + field_name + "_Item", items_schema)
                field_type = List[item_model]
            else:
                field_type = List[Any]
        elif json_type == "object":
            field_type = Dict[str, Any]
        else:
            field_type = Any

        if is_optional:
            field_type = Optional[field_type]

        namespace["__annotations__"][field_name] = field_type
        if field_name in required_fields:
            namespace[field_name] = Field(...)
        else:
            namespace[field_name] = Field(default=None)

    return type(name, (BaseModel,), namespace)


class MCPToolDiscovery:
    """Discovers and calls tools in MCP containers."""
    def __init__(self, container_name: str, command: List[str], discovery_method: str = "tools/discover",
                 call_method: str = "tools/call"):
        self.container_name = container_name
        self.command = command
        self.discovery_method = discovery_method
        self.call_method = call_method
        self.discovered_tools = []

    @traceable
    async def discover_tools(self) -> List[Dict[str, Any]]:
        """Discovers tools from the MCP container."""
        print(f"🔍 Discovering tools from container: {self.container_name}")
        print(f"🕵️ Discovery Method: {self.discovery_method}")

        try:
            discovery_payload = {
                "jsonrpc": "2.0",
                "method": self.discovery_method,
                "params": {},
                "id": "1"
            }
            print(f"Sending discovery payload: {discovery_payload}")
            command = ["docker", "exec", "-i", self.container_name] + self.command
            process = subprocess.run(
                command,
                input=json.dumps(discovery_payload) + "\n",
                capture_output=True,
                text=True,
            )
            stdout_lines = process.stdout.strip().split("\n")
            print("📥 Raw discovery response:", stdout_lines)
            if stdout_lines:
                last_line = None
                for line in reversed(stdout_lines):
                    if line.startswith("{") or line.startswith("["):
                        last_line = line
                        break
                if last_line:
                    try:
                        response = json.loads(last_line)
                        if "result" in response:
                            if isinstance(response["result"], list):
                                tools = response["result"]
                            elif isinstance(response["result"], dict) and "tools" in response["result"]:
                                tools = response["result"]["tools"]
                            else:
                                print("❌ Unexpected 'result' structure.")
                                return []
                        else:
                            tools = []
                        if tools:
                            print("✅ Discovered tools:", [tool["name"] for tool in tools])
                            return tools
                        else:
                            print("❌ No tools found in response.")
                            return []
                    except json.JSONDecodeError as e:
                        print(f"❌ JSON Decode Error: {e}")
                        return []
                else:
                    print("❌ No valid JSON response found.")
                    return []
            else:
                print("❌ No response lines received.")
                return []
        except Exception as e:
            print(f"❌ Error discovering tools: {e}")
            return []
        
    @traceable
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any], timeout=60):
        """Calls a tool in the MCP container with logging and error handling."""
        logger.info(f"🔍 Attempting to call tool: {tool_name}")
        logger.info(f"📦 Arguments: {arguments}")

        try:
            # Async network inspection
            process = await asyncio.create_subprocess_exec(
                "docker", "network", "inspect", "bridge",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            logger.info(f"🌐 Network Details: {stdout.decode()}")
        except Exception as e:
            logger.error(f"❌ Network inspection failed: {e}")

        command = ["docker", "exec", "-i", self.container_name] + self.command

        try:
            normalized_args = arguments

            if tool_name == "create_or_update_file" and isinstance(normalized_args, dict) and "sha" in normalized_args and normalized_args["sha"] is None:
                del normalized_args["sha"]

            payload = {
                "jsonrpc": "2.0",
                "method": self.call_method,
                "params": {"name": tool_name, "arguments": normalized_args},
                "id": "2",
            }

            logger.info(f"🚀 Full Payload: {json.dumps(payload)}")

            # Create async subprocess
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "PYTHONUNBUFFERED": "1"}
            )

            try:
                # Use asyncio.wait_for to add a timeout
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=json.dumps(payload).encode() + b"\n"),
                    timeout=timeout
                )

                logger.info(f"🔬 Subprocess Exit Code: {process.returncode}")
                logger.info(f"🔬 Full subprocess stdout: {stdout.decode()}")
                logger.info(f"🔬 Full subprocess stderr: {stderr.decode()}")

                if process.returncode != 0:
                    logger.error(f"❌ Subprocess returned non-zero exit code: {process.returncode}")
                    logger.error(f"🚨 Error Details: {stderr.decode()}")
                    return f"Subprocess Error: {stderr.decode()}"

                output_lines = stdout.decode().strip().split("\n")
                for line in reversed(output_lines):
                    try:
                        response = json.loads(line)
                        logger.info(f"✅ Parsed JSON response: {response}")

                        if "result" in response:
                            return response["result"]
                        elif "error" in response:
                            error_message = response["error"]
                            if "tool not found" in str(error_message).lower():
                                logger.error(f"🚨 Tool '{tool_name}' not found by service.")
                                return f"Tool Error: Tool '{error_message}"
                        else:
                            logger.warning("⚠️ Unexpected response structure")
                            return response
                    except json.JSONDecodeError:
                        continue

                logger.error("❌ No valid JSON response found")
                return "Error: No valid JSON response"

            except asyncio.TimeoutError:
                # Handle timeout gracefully
                logger.error(f"⏱️ Tool call to {tool_name} timed out after {timeout} seconds")
                try:
                    process.kill()  # Kill the subprocess
                except:
                    pass
                return f"Error: Tool call to {tool_name} timed out after {timeout} seconds"

        except Exception:
            logger.critical(f"🔥 Critical tool call error", exc_info=True) 
            return "Critical Error: tool call failure"
    
@traceable
async def get_tools_for_service(service_name, command, discovery_method, call_method, service_discoveries):
    """Enhanced tool discovery for each service."""
    print(f"🕵️ Discovering tools for: {service_name}")
    discovery = MCPToolDiscovery(
        container_name=service_name,
        command=command,
        discovery_method=discovery_method,
        call_method=call_method
    )
    service_discoveries[service_name] = discovery  # Store for future tool calls

    tools = []
    try:
        discovered_tools = await discovery.discover_tools()
        print(f"🛠️ Tools for {service_name}: {[t['name'] for t in discovered_tools]}")

        for tool in discovered_tools:
            tool_name = tool["name"]
            tool_description = tool.get("description", "")
            tool_schema = tool.get("inputSchema") or tool.get("parameters", {})

            if tool_schema and tool_schema.get("type") == "object":
                try:
                    input_model = schema_to_pydantic_model(tool_name + "_Input", tool_schema)

                    async def tool_call_wrapper(**kwargs):
                        validated_args = input_model(**kwargs).dict()
                        return await service_discoveries[service_name].call_tool(tool_name, validated_args, timeout=120)

                    structured_tool = StructuredTool.from_function(
                        name=tool_name,
                        description=tool_description,
                        args_schema=input_model,
                        func=(lambda tool_name=tool_name, input_model=input_model:
                            lambda **kwargs: asyncio.run(
                                service_discoveries[service_name].call_tool(tool_name, input_model(**kwargs).dict())
                            ))()
                    )

                    tools.append(structured_tool)
                except Exception as e:
                    logger.warning(f"⚠️ Failed to build structured tool {tool_name}: {e}")
            else:
                async def fallback_tool_call_wrapper(x):
                    return await service_discoveries[service_name].call_tool(tool_name, {"__arg1": x})

                fallback_tool = Tool(
                    name=tool_name,
                    description=tool_description,
                    func=lambda x: asyncio.run(fallback_tool_call_wrapper(x))
                )
                tools.append(fallback_tool)

    except Exception as e:
        logger.error(f"❌ Tool discovery error in {service_name}: {e}", exc_info=True)

    return tools

@traceable
async def load_all_tools():
    """Async function to load tools from different MCP services and local files."""
    print("🚨 COMPREHENSIVE TOOL DISCOVERY STARTING 🚨")

    tool_services = [
        ("pyats-mcp", ["python3", "pyats_mcp_server.py", "--oneshot"], "tools/discover", "tools/call"),
        ("github-mcp", ["node", "dist/index.js"], "list_tools", "call_tool"),
        ("google-maps-mcp", ["node", "dist/index.js"], "tools/list", "tools/call"),
        ("sequentialthinking-mcp", ["node", "dist/index.js"], "tools/list", "tools/call"),
        ("slack-mcp", ["node", "dist/index.js"], "tools/list", "tools/call"),
        ("excalidraw-mcp", ["node", "dist/index.js"], "tools/list", "tools/call"),
        ("filesystem-mcp", ["node", "/app/dist/index.js", "/projects"], "tools/list", "tools/call"),
        ("netbox-mcp", ["python3", "server.py", "--oneshot"], "tools/discover", "tools/call"),
        ("google-search-mcp", ["node", "/app/build/index.js"], "tools/list", "tools/call"),
        ("servicenow-mcp", ["python3", "server.py", "--oneshot"], "tools/discover", "tools/call"),
        ("email-mcp", ["node", "build/index.js"], "tools/list", "tools/call"),
        ("chatgpt-mcp", ["python3", "server.py", "--oneshot"], "tools/discover", "tools/call"),
    ]

    try:
        # Run docker ps to verify containers
        docker_ps_result = subprocess.run(["docker", "ps"], capture_output=True, text=True)
        print(docker_ps_result.stdout)

        service_discoveries = {}

        # Gather tools from all services
        all_service_tools = await asyncio.gather(
            *[get_tools_for_service(service, command, discovery_method, call_method, service_discoveries)
              for service, command, discovery_method, call_method in tool_services]
        )

        # Add local tools
        print("🔍 Loading Local Tools:")
        #local_tools = load_local_tools_from_folder("tools")
        #print(f"🧰 Local Tools Found: {[tool.name for tool in local_tools]}")

        # Combine all tools
        all_tools = []
        for tools_list in all_service_tools:
            if tools_list:
                all_tools.extend(tools_list)
        #all_tools.extend(local_tools)

        print("🔧 Comprehensive Tool Discovery Results:")
        print("✅ All Discovered Tools:", [t.name for t in all_tools])

        if not all_tools:
            print("🚨 WARNING: NO TOOLS DISCOVERED 🚨")
            print("Potential Issues:")
            print("1. Docker containers not running")
            print("2. Incorrect discovery methods")
            print("3. Network/communication issues")
            print("4. Missing tool configuration")

        return all_tools

    except Exception as e:
        print(f"❌ CRITICAL TOOL DISCOVERY ERROR: {e}")
        import traceback
        traceback.print_exc()
        return []

# Load tools
valid_tools = asyncio.run(load_all_tools())

def format_tool_descriptions(tools: List[Tool]) -> str:
    return "\n".join(
        f"- `{tool.name}`: {tool.description or 'No description provided.'}"
        for tool in tools
    )

embedding = GoogleGenerativeAIEmbeddings(model="models/embedding-001")

vector_store = InMemoryVectorStore(embedding=embedding)

tool_documents = [
    Document(
        page_content=f"Tool name: {tool.name}. Tool purpose: {tool.description}",
        metadata={"tool_name": tool.name}
    )
    for tool in valid_tools if hasattr(tool, "description")
]


document_ids = vector_store.add_documents(tool_documents)

print("🔧 All bound tools:", [t.name for t in valid_tools])

llm = ChatGoogleGenerativeAI(model="gemini-2.5-pro-exp-03-25", temperature=0.0)

llm_with_tools = llm.bind_tools(valid_tools)

@traceable
class ContextAwareToolNode(ToolNode):
    """
    A specialized ToolNode that handles tool execution and updates the graph state
    based on the tool's response.  It assumes that tools return a dictionary.
    """

    async def ainvoke(
        self, state: GraphState, config: Optional[RunnableConfig] = None, **kwargs: Any
    ):
        """
        Executes the tool call specified in the last AIMessage and updates the state.

        Args:
            state: The current graph state.
            config: Optional config object.
            **kwargs: Additional arguments for the invocation.

        Returns:
            The updated graph state.

        Raises:
            ValueError: If the last message is not an AIMessage with tool calls.
        """
        messages = state["messages"]
        last_message = messages[-1]

        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            raise ValueError("Expected an AIMessage with tool_calls")

        tool_calls = last_message.tool_calls
        context = state.get("context", {})

        for tool_call in tool_calls:
            tool_name = tool_call['name']

            if not (tool := self.tools_by_name.get(tool_name)):
                logger.warning(
                    f"Tool '{tool_name}' not found in the available tools. Skipping this tool call."
                )
                continue

            tool_input = tool_call['args']
            filtered_tool_input = {k: v for k, v in tool_input.items() if v is not None}
            logger.debug(f"Calling tool: {tool.name} with args: {filtered_tool_input}")

            tool_response = await tool.ainvoke(filtered_tool_input)

            if not isinstance(tool_response, dict):
                tool_response = {tool_name: tool_response}

            used = set(context.get("used_tools", []))
            used.add(tool.name)
            context["used_tools"] = list(used)

            # Update the context with the tool's output
            context.update(tool_response)

            # Create a ToolMessage and add it to the message history

            tool_message = ToolMessage(
                tool_call_id=tool_call['id'],
                content=tool_response.get("content", str(tool_response)),
                name=tool_call['name'],
            )

            messages.append(tool_message)

        return {
            "messages": messages,
            "context": context,
            "__next__": "handle_tool_results"
        }
    
@traceable
async def select_tools(state: GraphState):
    messages = state.get("messages", [])
    context = state.get("context", {})
    last_user_message = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)

    if not last_user_message:
        logger.warning("select_tools: No user message found.")
        state["selected_tools"] = []
        return {"messages": messages, "context": context}

    query = last_user_message.content
    selected_tool_names = []

    try:
        # Step 1: Vector search
        scored_docs = vector_store.similarity_search_with_score(query, k=35)

        # Step 2: Apply threshold with fallback
        threshold = 0.50
        relevant_docs = [doc for doc, score in scored_docs if score >= threshold]

        if not relevant_docs:
            logger.warning(f"⚠️ No tools above threshold {threshold}. Falling back to top 5 by score.")
            relevant_docs = [doc for doc, _ in scored_docs[:15]]

        logger.info(f"✅ Selected {len(relevant_docs)} tools after filtering/fallback.")

        # Step 3: Build tool info for LLM
        tool_infos = {
            doc.metadata["tool_name"]: doc.page_content
            for doc in relevant_docs if "tool_name" in doc.metadata
        }

        if not tool_infos:
            logger.warning("select_tools: No valid tool_name metadata found.")
            state["selected_tools"] = []
            return {"messages": messages, "context": context}

        # Log top tools and scores for debugging
        logger.info("Top tools with scores:")
        for doc, score in scored_docs[:10]:
            if "tool_name" in doc.metadata:
                logger.info(f"- {doc.metadata['tool_name']}: {score}")

        tool_descriptions_for_prompt = "\n".join(
            f"- {name}: {desc}" for name, desc in tool_infos.items()
        )

        # Step 4: LLM refinement
        tool_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a precise Tool Selector Assistant. Your task is to choose the most relevant tools from the provided list to fulfill the user's request.

Consider these guidelines:
- Match tools to the *exact* user intent.
- Refer to tool descriptions to understand their purpose.
- Prefer specific tools over general ones if applicable.
- If multiple tools seem relevant for sequential steps *explicitly requested*, list them.
- If no tool is a good fit, output "None".
- Output *only* a comma-separated list of the chosen tool names (e.g., tool_a,tool_b) or the word "None"."""),

            ("human", "User request:\n---\n{query}\n---\n\nAvailable tools:\n---\n{tools}\n---\n\nBased *only* on the tools listed above, which are the best fit for the request? Output only the comma-separated tool names or 'None'.")
        ])

        selection_prompt_messages = tool_prompt.format_messages(
            query=query,
            tools=tool_descriptions_for_prompt
        )

        logger.info("🤖 Invoking LLM for tool selection...")
        tool_selection_response = await llm.ainvoke(selection_prompt_messages)
        raw_selection = tool_selection_response.content.strip()

        logger.info(f"📝 LLM raw tool selection: '{raw_selection}'")

        if raw_selection.lower() == "none" or not raw_selection:
            selected_tool_names = []
        else:
            potential_names = [name.strip() for name in raw_selection.split(',')]
            selected_tool_names = [name for name in potential_names if name in tool_infos]
            if len(selected_tool_names) != len(potential_names):
                logger.warning(f"⚠️ LLM selected invalid tools: {set(potential_names) - set(selected_tool_names)}")

    except Exception as e:
        logger.error(f"🔥 Error during tool selection: {e}", exc_info=True)
        selected_tool_names = []

    # Final: Update context
    context["selected_tools"] = list(set(context.get("selected_tools", [])) | set(selected_tool_names))
    logger.info(f"✅ Final selected tools: {context['selected_tools']}")
    return {
        "messages": messages,
        "context": context
    }


system_msg = """You are a computer networking expert at the CCIE level. You are a precise and helpful assistant with access to a wide range of tools for networking, GitHub automation, Slack notifications, file system operations, and ServiceNow ticketing. You must follow strict guidelines before choosing and using tools.

AVAILABLE TOOL CATEGORIES:
{tool_descriptions}

📌 TOOL USAGE GUIDELINES:

GENERAL RULES:
1. THINK step-by-step about what the user wants.
2. MATCH tools to the *exact* user intent.
3. DO NOT guess. Only use tools when the user explicitly requests an action that matches the tool’s purpose.
4. NEVER call a tool without all required parameters.
5. NEVER call a tool just because the output of another tool suggests a next step — unless the user explicitly asked for that.

✅ WHEN TO USE TOOLS:

🧠 PYATS NETWORK AUTOMATION TOOLS:
- Use `pyATS_show_running_config`, `pyATS_run_show_command`, `pyATS_ping_from_network_device`, or `pyATS_configure_device` ONLY if the user requests network validation, inspection, or configuration of Cisco-style network devices.
- Do NOT use these tools for cloud or filesystem tasks.

📁 FILESYSTEM TOOLS:
- Use `write_file`, `edit_file`, `read_file`, or `create_directory` when the user asks to **create, modify, save, or read from files** in a local or mounted directory.
- Example: “Save the config to a markdown file” → `write_file`

🐙 GITHUB TOOLS:
- Use GitHub tools ONLY when the user explicitly asks to:
  - Push files
  - Create or update code or documentation in a repo
  - Open or manage GitHub issues or PRs
- Required for all GitHub actions: `owner`, `repo`, `branch`, and `commit message`
- NEVER use GitHub tools for local file management or Slack-style notifications.

💬 SLACK TOOLS:
- Use `slack_post_message`, `slack_reply_to_thread`, or `slack_add_reaction` only when the user asks to send messages to a Slack channel or thread.
- Example: “Notify the team” or “Send a message to #NOC” → `slack_post_message`

🗺️ MAPS TOOLS:
- Use `maps_geocode`, `maps_elevation`, etc., ONLY when the user asks for location-based data.
- NEVER use for IP addresses or configs.

📐 DIAGRAMMING TOOLS:
- Use `create_drawing`, `update_drawing`, `export_to_json` only when the user wants a network diagram or visual model.
- Do NOT export a drawing unless the user explicitly says so.

🛠️ SERVICE NOW TOOLS:
- ONLY use ServiceNow tools if the user explicitly says things like:
  - “Create a problem ticket in ServiceNow”
  - “Get the state of a ServiceNow problem”
  - if asked to create a problem in service now - only call the create service now problem tool; not the other service now problem tools. You only need 1 tool to create a problem.
- NEVER use ServiceNow tools to write files, notify teams, or log internal info.
- NEVER assume a ServiceNow ticket is needed unless the user says so.
- ⚠️ If the user does NOT mention “ServiceNow” or “ticket,” DO NOT CALL ANY ServiceNow tool.

📧 EMAIL TOOLS:
- Use email tools (like `email_send_message`) ONLY when the user explicitly asks to send an email.
- Examples: "Send an email to team@example.com with the results", "Email the configuration to the network admin".
- Required: Recipient email address(es), subject line, and the body content for the email.
- Specify clearly who the email should be sent to and what information it should contain.
- DO NOT use email tools for Slack notifications, saving files, or internal logging unless specifically instructed to email that information.

🤖 CHATGPT ANALYSIS TOOLS:
- Use the `ask_chatgpt` tool ONLY when the user explicitly asks you to leverage an external ChatGPT model for specific analysis, summarization, comparison, or generation tasks that go beyond your primary function or require a separate perspective.
- Examples: "Analyze this Cisco config for security best practices using ChatGPT", "Ask ChatGPT to summarize this document", "Get ChatGPT's explanation for this routing behavior".
- Required: The `content` (e.g., configuration text, document snippet, specific question) that needs to be sent to the external ChatGPT tool.
- Clearly state *why* you are using the external ChatGPT tool (e.g., "To get a detailed security analysis from ChatGPT...").
- Do NOT use this tool for tasks you are expected to perform directly based on your core instructions or other available tools (like running a show command or saving a file). Differentiate between *your* analysis/response and the output requested *from* the external ChatGPT tool.

🎯 TOOL CHAINING:
- Do NOT chain tools together unless the user clearly describes multiple steps.
  - Example: “Save the config to GitHub and notify Slack” → You may use two tools.
- Otherwise, assume single-tool usage unless explicitly stated.

🧠 BEFORE YOU ACT:
- Pause and explain your thought process.
- Say WHY the tool you're selecting is the best fit.
- If unsure, respond with a clarification question instead of calling a tool.

"""


@traceable
async def assistant(state: GraphState):
    """Handles assistant logic and LLM interaction, with support for sequential tool calls."""
    messages = state.get("messages", [])
    context = state.get("context", {})
    selected_tool_names = context.get("selected_tools", [])
    run_mode = context.get("run_mode", "start")

    used = set(context.get("used_tools", []))
    # If selected_tool_names is empty, fall back to ALL tools not already used
    if selected_tool_names:
        tools_to_use = [
            tool for tool in valid_tools 
            if tool.name in selected_tool_names and tool.name not in used
        ]
    else:
        # Broaden scope — allow Gemini to pick missed tools (Slack, GitHub, etc.)
        tools_to_use = [
            tool for tool in valid_tools 
            if tool.name not in used
        ]
    # If we're in continuous mode, don't re-select tools
    if run_mode == "continue":
        last_tool_message = None
        # Find the last tool message
        for msg in reversed(messages):
            if isinstance(msg, ToolMessage):
                last_tool_message = msg
                break

        if last_tool_message:
            # Add the tool message to ensure proper conversation context
            new_messages = [SystemMessage(content=system_msg)] + messages

            llm_with_tools = llm.bind_tools(tools_to_use)
            response = await llm_with_tools.ainvoke(new_messages, config={"tool_choice": "auto"})

            if hasattr(response, "tool_calls") and response.tool_calls:
                # Continue using tools
                return {"messages": [response], "context": context, "__next__": "tools"}
            else:
                # No more tools to use, return to user
                return {"messages": [response], "context": context, "__next__": "__end__"}

    # Initial processing or starting a new sequence
    llm_with_tools = llm.bind_tools(tools_to_use)
    formatted_tool_descriptions = format_tool_descriptions(tools_to_use)
    formatted_system_msg = system_msg.format(tool_descriptions=formatted_tool_descriptions)
    new_messages = [SystemMessage(content=formatted_system_msg)] + messages

    try:
        logger.info(f"assistant: Invoking LLM with new_messages: {new_messages}")
        # Always use auto tool choice to allow model to decide which tools to use
        response = await llm_with_tools.ainvoke(new_messages, config={"tool_choice": "auto"})
        logger.info(f"Raw LLM Response: {response}")

        if not isinstance(response, AIMessage):
            response = AIMessage(content=str(response))
    except Exception as e:
        logger.error(f"Error invoking LLM: {e}", exc_info=True)
        response = AIMessage(content=f"LLM Error: {e}")

    if hasattr(response, "tool_calls") and response.tool_calls:
        context["run_mode"] = "continue"
        return {"messages": [response], "context": context, "__next__": "tools"}
    else:
        context["run_mode"] = "start"
        return {"messages": [response], "context": context, "__next__": "__end__"}

@traceable
async def handle_tool_results(state: GraphState):
    messages = state.get("messages", [])
    context = state.get("context", {})
    run_mode = context.get("run_mode", "start")

    # Always reset run_mode to prevent infinite loops unless LLM explicitly continues
    context["run_mode"] = "start"

    # If assistant previously requested tool(s), allow assistant to assess next step
    return {
        "messages": messages,
        "context": context,
        "__next__": "assistant"
    }

# Graph setup
graph_builder = StateGraph(GraphState)

# Define core nodes
graph_builder.add_node("select_tools", select_tools)
graph_builder.add_node("assistant", assistant)
graph_builder.add_node("tools", ContextAwareToolNode(tools=valid_tools))
graph_builder.add_node("handle_tool_results", handle_tool_results)

# Define clean and minimal edges
# Start flow
graph_builder.add_edge(START, "select_tools")

# After tool selection, go to assistant
graph_builder.add_edge("select_tools", "assistant")

# Assistant decides: use tool or end
graph_builder.add_conditional_edges(
    "assistant",
    lambda state: state.get("__next__", "__end__"),
    {
        "tools": "tools",
        "__end__": END,
    }
)

# Tools always go to handler
graph_builder.add_edge("tools", "handle_tool_results")

# Tool results always return to assistant
graph_builder.add_edge("handle_tool_results", "assistant")

# Compile graph
compiled_graph = graph_builder.compile()

async def run_cli_interaction():
    """Runs the CLI interaction loop."""
    state = {"messages": [], "context": {"used_tools": []}}
    while True:
        user_input = input("User: ")
        if user_input.lower() in ["exit", "quit"]:
            print("👋 Exiting...")
            break

        user_message = HumanMessage(content=user_input)
        state["messages"].append(user_message)
        state["context"]["used_tools"] = []

        print("🚀 Invoking graph...")
        result = await compiled_graph.ainvoke(state, config={"recursion_limit": 100})
        state = result

        for message in reversed(state["messages"]):
            if isinstance(message, AIMessage):
                print("Assistant:", message.content)
                break

if __name__ == "__main__":
    asyncio.run(run_cli_interaction())
