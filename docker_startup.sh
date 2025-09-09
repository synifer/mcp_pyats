#!/bin/bash

# Load environment variables from .env
if [ -f .env ]; then
  source .env
  echo "Loaded environment variables from .env"
else
  echo ".env file not found. Using default values."
fi

####################
#                  #
# Build containers #
#                  #
####################

echo "Building github-mcp image..."
docker build -t github-mcp ./github
if [ $? -ne 0 ]; then echo "Error building github-mcp image."; exit 1; fi
echo "github-mcp image built successfully."

echo "Building google-maps-mcp image..."
docker build -t google-maps-mcp ./google_maps
if [ $? -ne 0 ]; then echo "Error building google-maps-mcp image."; exit 1; fi
echo "google-maps-mcp image built successfully."

echo "Building sequentialthinking-mcp image..."
docker build -t sequentialthinking-mcp ./sequentialthinking
if [ $? -ne 0 ]; then echo "Error building sequentialthinking-mcp image."; exit 1; fi
echo "sequentialthinking-mcp image built successfully."

echo "Building slack-mcp image..."
docker build -t slack-mcp ./slack
if [ $? -ne 0 ]; then echo "Error building slack-mcp image."; exit 1; fi
echo "slack-mcp image built successfully."

echo "Building excalidraw-mcp image..."
docker build -t excalidraw-mcp ./excalidraw
if [ $? -ne 0 ]; then echo "Error building excalidraw-mcp image."; exit 1; fi
echo "excalidraw-mcp image built successfully."

echo "Building filesystem-mcp image..."
docker build -t filesystem-mcp ./filesystem
if [ $? -ne 0 ]; then echo "Error building filesystem-mcp image."; exit 1; fi
echo "filesystem-mcp image built successfully."

echo "Building netbox-mcp image..."
docker build -t netbox-mcp ./netbox
if [ $? -ne 0 ]; then echo "Error building netbox-mcp image."; exit 1; fi
echo "netbox-mcp image built successfully."

echo "Building google-search-mcp image..."
docker build -t google-search-mcp ./google_search
if [ $? -ne 0 ]; then echo "Error building google-search-mcp image."; exit 1; fi
echo "google-search-mcp image built successfully."

echo "Building sericenow-mcp image..."
docker build -t servicenow-mcp ./servicenow
if [ $? -ne 0 ]; then echo "Error building servicenow-mcp image."; exit 1; fi
echo "servicenow-mcp image built successfully."

echo "Building email-mcp image..."
docker build -t email-mcp ./email
if [ $? -ne 0 ]; then echo "Error building email-mcp image."; exit 1; fi
echo "email-mcp image built successfully."

echo "Building pyats-mcp image..."
docker build -t pyats-mcp ./pyats_mcp_server
if [ $? -ne 0 ]; then echo "Error building pyats-mcp image."; exit 1; fi
echo "pyats-mcp image built successfully."

echo "Building chatgpt-mcp image..."
docker build -t chatgpt-mcp ./chatgpt
if [ $? -ne 0 ]; then echo "Error building chatgpt-mcp image."; exit 1; fi
echo "chatgpt-mcp image built successfully."

echo "Building quickchart-mcp image..."
docker build -t quickchart-mcp ./quickchart
if [ $? -ne 0 ]; then echo "Error building quickchart-mcp image."; exit 1; fi
echo "quickchart-mcp image built successfully."

echo "Building vegalite-mcp image..."
docker build -t vegalite-mcp ./vegalite
echo "vegalite-mcp image built successfully"

echo "Building streamlit-app image..."
docker build -t streamlit-app ./streamlit
if [ $? -ne 0 ]; then echo "Error building streamlit-app image."; exit 1; fi
echo "streamlit-app image built successfully."

echo "Building langgraph container (mcpyats)..."
docker build -t mcpyats -f ./mcpyats/Dockerfile ./mcpyats
if [ $? -ne 0 ]; then echo "Error building mcpyats image."; exit 1; fi
echo "mcpyats image built successfully."

#######
#     #
# RUN #
#     #
#######

echo "Starting github-mcp container..."
docker run -dit --name github-mcp -e GITHUB_TOKEN="${GITHUB_TOKEN:-YOUR_GITHUB_TOKEN}" github-mcp
echo "github-mcp container started."

echo "Starting google-maps-mcp container..."
docker run -dit --name google-maps-mcp -e GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-YOUR_GOOGLE_MAPS_API_KEY}" google-maps-mcp
echo "google-maps-mcp container started."

echo "Starting sequentialthinking-mcp container..."
docker run -dit --name sequentialthinking-mcp sequentialthinking-mcp
echo "sequentialthinking-mcp container started."

echo "Starting slack-mcp container..."
docker run -dit --name slack-mcp -e SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-YOUR_SLACK_BOT_TOKEN}" -e SLACK_TEAM_ID="${SLACK_TEAM_ID:-YOUR_SLACK_TEAM_ID}" slack-mcp
echo "slack-mcp container started."

echo "Starting excalidraw-mcp container..."
docker run -dit --name excalidraw-mcp excalidraw-mcp
echo "excalidraw-mcp container started."

docker run -dit \
  --name filesystem-mcp \
  -v "/home/johncapobianco/pyATS_MCP:/projects" \
  filesystem-mcp

echo "Starting netbox-mcp container..."
docker run -d --name netbox-mcp -e NETBOX_URL="${NETBOX_URL:-YOUR_SELECTOR_URL}" -e NETBOX_TOKEN="${NETBOX_TOKEN:-NETBOX_TOKEN}" netbox-mcp python3 server.py --restart unless-stopped
echo "netbox-mcp container started."

echo "Starting google-search-mcp container..."
docker run -dit --name google-search-mcp google-search-mcp
echo "google-search-mcp container started."

echo "Starting service now-mcp container..."
docker run -d --name servicenow-mcp \
 --env-file .env \
 servicenow-mcp python3 server.py --restart unless-stopped
echo "servicenow-mcp container started."

echo "Starting email-mcp container..."
docker run -dit --name email-mcp --env-file .env --dns 8.8.8.8 email-mcp
echo "email-mcp container started."

echo "Starting cahtgpt-mcp container..."
docker run -dit --name chatgpt-mcp \
 --env-file .env \
 chatgpt-mcp python3 server.py --restart unless-stopped
echo "chatgpt-mcp container started."

echo "Starting pyats-mcp container..."
docker run -d --name pyats-mcp \
  -e PYATS_TESTBED_PATH="/app/testbed.yaml" \
  -v "$(pwd)/pyats_mcp_server/testbed.yaml:/app/testbed.yaml" \
  pyats-mcp
echo "pyats-mcp container started."

echo "Starting quickchart-mcp container..."
docker run -dit --name quickchart-mcp quickchart-mcp
echo "quickchart-mcp container started."

echo "Starting vegalite-mcp container..."
docker run -dit --name vegalite-mcp \
  -v "/home/johncapobianco/MCPyATS:/output" \
  vegalite-mcp
echo "pyats-mcp container started."

# # Check if last MCP containers are running
if ! docker ps | grep -q "vegalite-mcp"; then
    echo "vegalite-mcp container not found."
    exit 1
fi

sleep 2

echo "Starting mcpyats container..."
docker run -p 2024:2024 -dit \
    -v /var/run/docker.sock:/var/run/docker.sock \
    --name mcpyats \
    mcpyats
echo "mcpyats container started."

echo "Starting streamlit-app container..."
docker run -d --name streamlit-app -p 8501:8501 streamlit-app
echo "streamlit-app container started at http://localhost:8501"

echo "All containers started."