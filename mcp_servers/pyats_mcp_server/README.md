This server bridges Cisco pyATS with the MCP ecosystem, allowing real-time network automation actions such as running show commands, pushing configurations, learning device state, and pinging endpoints — all exposed as callable tools.

📌 Available Tools

Tool Name	Description

pyATS_run_show_command	Runs a show command (e.g. show ip interface brief) on a Cisco IOS/NX-OS device. Returns structured or raw output.

pyATS_configure_device	Applies configuration commands (single or multi-line) to a Cisco device.

pyATS_show_running_config	Retrieves the current running configuration from a device (raw text).

pyATS_show_logging	Retrieves the latest logs using show logging last 250.

pyATS_ping_from_network_device	Executes a ping command on a Cisco IOS/NX-OS device to test reachability.

pyATS_run_linux_command	Executes common Linux commands (e.g., ifconfig, ls -l, ps -ef) on testbed-managed Linux devices.

🔧 Parameters Overview

Each tool validates input using Pydantic models. Here's a sample of required parameters:

pyATS_run_show_command, pyATS_ping_from_network_device

```json
{
  "device_name": "string (required)",
  "command": "string (required)"
}
```
pyATS_configure_device

```json
{
  "device_name": "string (required)",
  "config_commands": "string (required)"
}
```

pyATS_run_linux_command

```json
{
  "device_name": "string (required)",
  "command": "string (required)"
}
```

🧪 Tool Safety & Parsing

Show/ping commands are first parsed using Genie. If parsing fails, they fall back to raw execution.

Dangerous commands like erase, reload, write are blocked in config mode.

Logging output is cleaned of ANSI sequences.

Linux tools support redirection/pipes (e.g., ps -ef | grep ssh).