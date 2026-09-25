# Nocturne backend runner — Node + Python + build tools, runs user code as non-root 'coder'.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_ROOT_USER_ACTION=ignore \
    NODE_ENV=development

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      build-essential git curl ca-certificates tini procps \
    && rm -rf /var/lib/apt/lists/*

# All user code runs as this unprivileged account (node image already uses uid 1000).
RUN useradd -m -u 1001 -s /bin/bash coder \
    && mkdir -p /workspaces \
    && chown coder:coder /workspaces

WORKDIR /workspaces
USER coder
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sleep","infinity"]
