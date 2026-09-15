#!/usr/bin/env bash
# Checks that the compose files keep the sync security wiring the refusal suite assumes but
# never exercises: read-only certificate mounts that must exist on the host, the broker
# publishing only 61617 on ARTEMIS_BIND_ADDR, and no stack defaulting payload encryption off.
#
#   qa/sync/verify-compose-wiring.sh
#
# Renders both stacks from the env examples with `docker compose config`. Needs docker and python3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'ARTEMIS_BIND_ADDR=192.0.2.10\nTLS_CERT_DIR=/nonexistent\n' > "$WORK/override.env"
docker compose -f "$ROOT/distribution/compose/central/docker-compose.yml" --env-file "$ROOT/distribution/env/central.env.example" \
  --env-file "$WORK/override.env" config --format json > "$WORK/central.json" 2>/dev/null
docker compose -f "$ROOT/distribution/compose/facility/docker-compose.yml" --env-file "$ROOT/distribution/env/facility.env.example" \
  --env-file "$WORK/override.env" --profile sync config --format json > "$WORK/facility.json" 2>/dev/null

python3 - "$WORK/central.json" "$WORK/facility.json" "$ROOT/distribution/compose" <<'PY'
import json, pathlib, re, sys

central = json.load(open(sys.argv[1]))["services"]
facility = json.load(open(sys.argv[2]))["services"]
problems = []

def mount(service, target):
    return next((v for v in service.get("volumes", []) if v.get("target") == target), None)

for name, service, target in [("central artemis", central["artemis"], "/etc/broker-certs"),
                              ("central sync-receiver", central["sync-receiver"], "/app/sync-certs"),
                              ("central cert-expiry", central["cert-expiry"], "/public"),
                              ("facility sync", facility["sync"], "/app/sync-certs")]:
    m = mount(service, target)
    if m is None or not m.get("read_only"):
        problems.append(f"{name}: {target} must be mounted read-only")
    elif m.get("bind", {}).get("create_host_path", True):
        problems.append(f"{name}: {target} must not be created when the host path is missing")

ports = central["artemis"].get("ports", [])
if [str(p.get("target")) for p in ports] != ["61617"]:
    problems.append(f"central artemis: only 61617 may be published, got {[p.get('target') for p in ports]}")
elif ports[0].get("host_ip") != "192.0.2.10":
    problems.append(f"central artemis: 61617 must bind ARTEMIS_BIND_ADDR, got {ports[0].get('host_ip')}")

for compose in pathlib.Path(sys.argv[3]).glob("*/docker-compose.yml"):
    if re.search(r"SYNC_PAYLOAD_ENCRYPTION:-false", compose.read_text()):
        problems.append(f"{compose}: SYNC_PAYLOAD_ENCRYPTION must not default to false")

if problems:
    print("FAIL: " + "\n      ".join(problems), file=sys.stderr)
    sys.exit(1)
print("PASS: the compose files keep the sync security wiring")
PY
