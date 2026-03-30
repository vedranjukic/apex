# syntax=docker/dockerfile:1
# Minimal image for the LLM API key proxy sandbox.
# Only includes Node.js, curl, and the Daytona daemon — no dev tools.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m daytona && echo "daytona ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/91-daytona

ARG TARGETARCH
COPY default/assets/daytona-daemon-${TARGETARCH} /usr/local/bin/daytona-daemon
RUN chmod +x /usr/local/bin/daytona-daemon

ENV DAYTONA_SANDBOX_USER=daytona

USER daytona
WORKDIR /home/daytona

ENTRYPOINT [ "/bin/sh", "-c", "/usr/local/bin/daytona-daemon & sleep infinity" ]
