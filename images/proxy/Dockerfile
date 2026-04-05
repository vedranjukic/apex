# syntax=docker/dockerfile:1
# Minimal image for the proxy sandbox (LLM proxy + MITM secrets proxy).
# Rust binary replaces Node.js — only curl and the Daytona daemon are needed.

# ── Stage 1: Build the Rust binary ────────────────────
FROM rust:1.82-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY proxy/ .
RUN cargo build --release

# ── Stage 2: Minimal runtime image ───────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m daytona && echo "daytona ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/91-daytona

# Copy Rust proxy binary from builder
COPY --from=builder /build/target/release/apex-proxy /usr/local/bin/apex-proxy

ARG TARGETARCH
COPY default/assets/daytona-daemon-${TARGETARCH} /usr/local/bin/daytona-daemon
RUN chmod +x /usr/local/bin/daytona-daemon /usr/local/bin/apex-proxy

ENV DAYTONA_SANDBOX_USER=daytona

USER daytona
WORKDIR /home/daytona

ENTRYPOINT [ "/bin/sh", "-c", "/usr/local/bin/daytona-daemon & sleep infinity" ]
