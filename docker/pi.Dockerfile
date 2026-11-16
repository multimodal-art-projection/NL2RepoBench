FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496 AS node
FROM python:3.12-bookworm@sha256:4209fae09a3e20afd863e528bfddc235da5fd5977983e1996cd54cc9a72e6267

COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ripgrep curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bookworm's fd is too old for Pi's --no-require-git flag. Pin a compatible static binary.
RUN curl --fail --silent --show-error --location --retry 3 \
      https://github.com/sharkdp/fd/releases/download/v10.5.2/fd-v10.5.2-x86_64-unknown-linux-musl.tar.gz \
      --output /tmp/fd.tar.gz \
    && printf '%s  %s\n' 7e2d07fa2b8807642aaec67b7e2972a9fbe4db26fcb340a7372392db42b26694 /tmp/fd.tar.gz | sha256sum --check - \
    && tar -xzf /tmp/fd.tar.gz -C /tmp \
    && install -m 0755 /tmp/fd-v10.5.2-x86_64-unknown-linux-musl/fd /usr/local/bin/fd \
    && rm -rf /tmp/fd.tar.gz /tmp/fd-v10.5.2-x86_64-unknown-linux-musl

WORKDIR /opt/pi-runtime
COPY pi_agent/runtime/package.json pi_agent/runtime/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY pi_agent/runtime/tsconfig.json ./
COPY pi_agent/runtime/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

ARG RUNTIME_SHA256
LABEL org.nl2repobench.pi-version="1.5.2" \
      org.nl2repobench.runtime-sha256=$RUNTIME_SHA256
ENV PI_OFFLINE=1 PI_CODING_AGENT_DIR=/pi-home \
    PYTHONDONTWRITEBYTECODE=1 NL2REPO_RUNTIME_SHA256=$RUNTIME_SHA256
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/pi-runtime/dist/main.js"]
