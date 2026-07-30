#!/usr/bin/env bash
# Deploys or upgrades a facility instance.
#
#   scripts/deploy/deploy-facility.sh --env distribution/env/facility.env
#   scripts/deploy/deploy-facility.sh --env distribution/env/demo.env --demo --local
#
# Follow docs/runbooks/deploy.md — this script automates the mechanics, not the
# preconditions. In particular it will NOT take your backup for you.
#
# --demo adds docker-compose.demo.yml, which swaps in the -demo images (built WITH
# content-demo) and disables sync. Training only: docs/runbooks/demo-stack.md.
#
# --local skips the registry pull and runs whatever build-distribution.sh just put in the
# local daemon. Without it a training box that built its own images fails on `pull`, which
# cannot find a tag nobody has pushed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE=""
DEMO="false"
LOCAL="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)   ENV_FILE="$2"; shift 2 ;;
    --demo)  DEMO="true";   shift ;;
    --local) LOCAL="true";  shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# A production instance must run a published, immutable tag — "it works on this machine"
# is the whole failure mode the two-artefact model exists to prevent (ADR 0001).
if [[ "$LOCAL" == "true" && "$DEMO" == "false" ]]; then
  echo "--local is for demo/training stacks only; a facility deploys a published tag" >&2
  exit 2
fi

[[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || { echo "--env <file> is required" >&2; exit 2; }

COMPOSE_DIR="$ROOT/distribution/compose/facility"
compose_args=(-f "$COMPOSE_DIR/docker-compose.yml")

if [[ "$DEMO" == "true" ]]; then
  compose_args+=(-f "$COMPOSE_DIR/docker-compose.demo.yml")

  # A demo stack pointed at the production database or the real central instance stops
  # being a demo stack. Both are cheap to check and expensive to discover afterwards.
  if grep -qiE '^[[:space:]]*CENTRAL_URL[[:space:]]*=.*(central\.moh\.gov\.lr|https://)' "$ENV_FILE"; then
    echo "refusing: ${ENV_FILE##*/} points CENTRAL_URL at a real central instance" >&2
    echo "          A training stack must never be able to reach central." >&2
    exit 1
  fi

  cat <<'PROMPT'
DEMO / TRAINING STACK — this instance loads content-demo and is NOT a rehearsal of
production configuration (demo metadata overrides the site layer).

Before continuing, confirm:
  * this is training hardware, not a facility production machine
  * the database in this env file is a throwaway, not a facility database
  * no real patient data will be entered here — everything typed in is synthetic
PROMPT
else
  cat <<'PROMPT'
Before continuing, confirm:
  * the upgrade test passed in CI for this exact release
  * a database backup exists AND its restore has been rehearsed
  * the maintenance window is agreed with the facility
PROMPT
fi

read -r -p "All confirmed? [yes/NO] " answer
[[ "$answer" == "yes" ]] || { echo "aborted"; exit 1; }

# No --profile sync in either case: on a demo stack the sync service is neutralised in the
# overlay, and on a facility it is enabled deliberately, not as a side effect of a deploy.
if [[ "$LOCAL" == "true" ]]; then
  echo "--local: using the images already in this Docker daemon, skipping pull"
else
  docker compose "${compose_args[@]}" --env-file "$ENV_FILE" pull
fi
docker compose "${compose_args[@]}" --env-file "$ENV_FILE" up -d

echo
echo "Watch Initializer complete before declaring success:"
echo "  docker compose ${compose_args[*]} --env-file $ENV_FILE logs -f backend"
echo
if [[ "$DEMO" == "true" ]]; then
  echo "Then run the verification steps in docs/runbooks/demo-stack.md."
else
  echo "Then run the post-deploy checks in docs/runbooks/deploy.md."
fi
