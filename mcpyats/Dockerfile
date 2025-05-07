FROM ubuntu:latest

ARG DEBIAN_FRONTEND=noninteractive

RUN echo "==> Upgrading apk and installing system utilities ...." \
 && apt -y update \
 && apt-get install -y wget \
 && apt-get -y install sudo

RUN echo "==> Installing Python3 and pip ...." \  
  && apt-get update && apt-get install -y --fix-missing python3 python3-pip

RUN echo "==> Install langchain requirements.." \
  && pip install --break-system-packages -U --quiet langchain_experimental langchain langchain-community langchain_google_genai langchain_openai

RUN echo "==> Adding dotenv ..." \
  && pip install --break-system-packages python-dotenv

RUN echo "==? Install langgraph and required components" \
  && pip install --break-system-packages --upgrade "langgraph-cli[inmem]" \
  && pip install --break-system-packages --upgrade "langgraph>=0.0.30" \
  && pip install --break-system-packages langsmith \
  && pip install --break-system-packages fastapi \
  && pip install --break-system-packages mcp \
  && pip install --break-system-packages google-generativeai

# ✅ Install Docker CLI (not full daemon)
RUN apt-get update && \
    apt-get install -y docker.io && \
    rm -rf /var/lib/apt/lists/*


RUN pip install --break-system-packages --upgrade "langgraph>=0.0.45"

COPY . .

COPY ./scripts /scripts/

CMD ["/bin/bash", "/scripts/startup.sh"]