# Aevify development image: Node 22 + the tools used by every service in docker-compose.yml.
# The repository is bind-mounted at /app, so this image contains no project code.
# Dependencies live in the `node_modules` volume and are installed by the `deps` service.

FROM node:22-bookworm-slim

# curl: handy for RPC checks (see DEPLOY.md). ca-certificates: HTTPS for npm and the solc download.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false

# Create the mount points owned by the unprivileged `node` user, so the named volumes
# (node_modules, Hardhat compiler cache, Hardhat keystore) inherit that ownership.
RUN mkdir -p /app/node_modules \
             /home/node/.cache/hardhat-nodejs \
             /home/node/.config/hardhat-nodejs \
 && chown -R node:node /app /home/node

COPY --chmod=755 docker/install-deps.sh /usr/local/bin/install-deps

USER node
WORKDIR /app
