#!/bin/sh
# Installs npm dependencies into the shared `node_modules` volume, but only when
# package.json files or the lockfile have changed since the last install.
set -eu

cd /app

deps_hash() {
  cat package-lock.json package.json apps/*/package.json packages/*/package.json 2>/dev/null \
    | sha256sum | cut -d ' ' -f 1
}

STAMP=node_modules/.aevify-deps-hash

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$(deps_hash)" ]; then
  echo "Dependencies are up to date."
  exit 0
fi

echo "Installing dependencies (first run, or package files changed)..."
npm install --no-audit --no-fund

# Hash after installing, in case npm updated the lockfile.
deps_hash > "$STAMP"
echo "Dependencies installed."
