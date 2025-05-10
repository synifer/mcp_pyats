This MCP server provides an external reasoning engine using OpenAI’s GPT-4o via structured tool calls. It acts as an "AI copilot" for advanced analysis, summarization, or comparison tasks that may go beyond the built-in LangGraph agent's capabilities.

📌 Available Tool

Tool Name	Description

ask_chatgpt	Sends the provided content to ChatGPT (via GPT-4o) for interpretation, summarization, comparison, or transformation. Use this only when explicitly instructed to ask ChatGPT for a second opinion or detailed reasoning beyond the primary agent’s scope.

🔧 Parameters
```json
{
  "content": "string (required) - The prompt, document, or config to send to ChatGPT"
}
```