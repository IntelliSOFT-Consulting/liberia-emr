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
cat > "$WORK/probe.yml" <<'YML'
services:
  explicit-false:
    image: scratch
    volumes:
      - {type: bind, source: /nonexistent, target: /probe, bind: {create_host_path: false}}
  explicit-true:
    image: scratch
    volumes:
      - {type: bind, source: /nonexistent, target: /probe, bind: {create_host_path: true}}
YML
render() { # name compose-file [compose-options]
  docker compose -f "$2" "${@:3}" config --format json > "$WORK/$1.json" 2> "$WORK/render.err" \
    || { echo "FAIL: the $1 compose file does not render:" >&2; cat "$WORK/render.err" >&2; exit 1; }
}
render central "$ROOT/distribution/compose/central/docker-compose.yml" \
  --env-file "$ROOT/distribution/env/central.env.example" --env-file "$WORK/override.env"
render facility "$ROOT/distribution/compose/facility/docker-compose.yml" \
  --env-file "$ROOT/distribution/env/facility.env.example" --env-file "$WORK/override.env" --profile sync
render probe "$WORK/probe.yml" -p probe

python3 - "$WORK" "$ROOT/distribution/compose" <<'PY'
import json, pathlib, re, sys

work = pathlib.Path(sys.argv[1])
central, facility, probe = (json.load(open(work / f"{n}.json"))["services"] for n in ("central", "facility", "probe"))
problems = []

# Compose releases leave a different create_host_path value out of the rendered file (2.38 drops
# false, 5.x drops true), so each mount is compared with how this release renders an explicit false.
explicit_false, explicit_true = (probe[s]["volumes"][0].get("bind") for s in ("explicit-false", "explicit-true"))
if explicit_false in (None, explicit_true):
    problems.append("this compose release does not render create_host_path: false distinctly; check the mounts by hand")

def mount(service, target):
    return next((v for v in service.get("volumes", []) if v.get("target") == target), None)

for name, service, target in [("central artemis", central["artemis"], "/etc/broker-certs"),
                              ("central sync-receiver", central["sync-receiver"], "/app/sync-certs"),
                              ("central cert-expiry", central["cert-expiry"], "/public"),
                              ("facility sync", facility["sync"], "/app/sync-certs")]:
    m = mount(service, target)
    if m is None or m.get("type") != "bind" or not m.get("read_only"):
        problems.append(f"{name}: {target} must be a read-only bind mount")
    elif m.get("bind") != explicit_false:
        problems.append(f"{name}: {target} must not be created when the host path is missing")

ports = central["artemis"].get("ports", [])
if [str(p.get("target")) for p in ports] != ["61617"]:
    problems.append(f"central artemis: only 61617 may be published, got {[p.get('target') for p in ports]}")
elif ports[0].get("host_ip") != "192.0.2.10":
    problems.append(f"central artemis: 61617 must bind ARTEMIS_BIND_ADDR, got {ports[0].get('host_ip')}")

for compose in pathlib.Path(sys.argv[2]).glob("*/docker-compose.yml"):
    if re.search(r"SYNC_PAYLOAD_ENCRYPTION:-false", compose.read_text()):
        problems.append(f"{compose}: SYNC_PAYLOAD_ENCRYPTION must not default to false")

if problems:
    print("FAIL: " + "\n      ".join(problems), file=sys.stderr)
    sys.exit(1)
print("PASS: the compose files keep the sync security wiring")
PY
