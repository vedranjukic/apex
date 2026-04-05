FROM mcr.microsoft.com/devcontainers/typescript-node:22

# Install additional OS packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        postgresql-client \
        musl-tools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain + Linux musl cross-compilation target
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && . "$HOME/.cargo/env" \
    && rustup target add x86_64-unknown-linux-musl

# Install global Node.js packages
RUN npm install -g typescript ts-node nodemon
