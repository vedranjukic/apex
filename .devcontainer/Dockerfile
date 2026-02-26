FROM mcr.microsoft.com/devcontainers/typescript-node:22

# Install additional OS packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        postgresql-client \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install global Node.js packages
RUN npm install -g typescript ts-node nodemon
