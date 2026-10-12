#!/usr/bin/env bash
# Deploy Machine Lab inside a Hyperbox sandbox (needs git, node >= 20, hbx-self).
# Usage: [LAB_TOKEN=secret] bash scripts/deploy-hyperbox.sh [port]   (run from inside the cloned repo)
# With LAB_TOKEN set, open the preview URL once as /?token=secret.
set -euo pipefail
PORT="${1:-8090}"
cd "$(dirname "$0")/.."
npm ci
npm run build
ENV_ARGS=(--env "PORT=$PORT" --env NODE_ENV=production)
[ -n "${LAB_TOKEN:-}" ] && ENV_ARGS+=(--env "LAB_TOKEN=$LAB_TOKEN")
hbx-self service put machine-lab --http-port "$PORT" "${ENV_ARGS[@]}" -- \
  sh -c "cd '$PWD' && exec node server/index.mjs"
hbx-self expose "$PORT"
