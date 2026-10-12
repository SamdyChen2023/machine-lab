#!/usr/bin/env bash
# Deploy Machine Lab inside a Hyperbox sandbox (needs git, node >= 20, hbx-self).
# Usage: bash scripts/deploy-hyperbox.sh [port]   (run from inside the cloned repo)
set -euo pipefail
PORT="${1:-8090}"
cd "$(dirname "$0")/.."
npm ci
npm run build
hbx-self service put machine-lab --http-port "$PORT" --env "PORT=$PORT" --env NODE_ENV=production -- \
  sh -c "cd '$PWD' && exec node server/index.mjs"
hbx-self expose "$PORT"
