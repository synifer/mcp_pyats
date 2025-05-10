# 🧾 ServiceNow MCP Server

This MCP-compatible server enables AI agents to interact with ServiceNow's Problem Management module via structured tool calls. It supports creating, updating, and retrieving problem tickets using JSON-RPC over STDIO.

## 🚀 Features

- Create new ServiceNow problems
- Retrieve the `sys_id` of a problem by number
- Get the state of an existing problem by `sys_id`
- Fetch detailed problem data as JSON
- Update a problem ticket using `sys_id`

## 🧰 Tools

This MCP server exposes the following tools:

| Tool Name | Description |
|----------|-------------|
| `create_servicenow_problem` | 🚨 Creates a new problem ticket in ServiceNow. |
| `get_servicenow_problem_sys_id` | 🔍 Retrieves the `sys_id` for a problem based on its number. |
| `get_servicenow_problem_state` | 📊 Returns the state of a problem by its `sys_id`. |
| `get_servicenow_problem_details` | 📄 Fetches the full JSON representation of a problem. |
| `update_servicenow_problem` | ✏️ Updates an existing problem using its `sys_id`. |

## 🔐 Environment Variables

Place these in your `.env` file:

```env

SERVICENOW_URL=https://your-instance.service-now.com

SERVICENOW_USERNAME=your_username

SERVICENOW_PASSWORD=your_password

⚠️ Avoid trailing slashes in SERVICENOW_URL.

🧪 Usage

Run the server with:

```bash
python server.py
```

Or in one-shot mode (for LangGraph integration):

```bash
python server.py --oneshot
```
📦 Folder Structure

```graphql
servicenow/
├── server.py          # Main MCP tool server implementation
├── Dockerfile         # Optional containerization support
└── README.md          # You're here!
```

📝 Notes

All HTTP requests use basic authentication and JSON headers.

Redirections are blocked by default to prevent improper credential usage.

SSL certificate verification is disabled (verify=False)—you may change this if needed in production.