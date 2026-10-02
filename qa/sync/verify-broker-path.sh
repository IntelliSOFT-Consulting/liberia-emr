#!/usr/bin/env bash
# QA check for sync over HTTPS on 443 (LE-372, ADR 0014): a facility reaches the broker through
# https://<central>/sync/broker/ on the gateway, inside a WebSocket tunnel at each end, with
# 61617 unreachable. The facility's mutual TLS travels inside unopened, so every refusal the
# broker makes on 61617 must hold through the path too; the OpenWire client the facilities run
# proves it. A second facility that can leave its network only through a forward proxy (HTTP
# CONNECT) must get through as well.
#
#   qa/sync/verify-broker-path.sh --gateway-image <image> --broker-image <image> \
#     --sender-image <image> --stub-image <image> [--proxy-image ubuntu/squid:6.6-24.04_edge] \
#     [--jdk-image maven:3.9-eclipse-temurin-17] [--keep]
#
# The tunnel services run exactly as the compose files define them (image and command are read
# from `docker compose config`). --stub-image is any image with busybox httpd (the sync-capture
# exporter's will do); it stands in for the frontend and backend the gateway proxies to.
# Self-contained: throwaway material from scripts/security/gen-sync-certs.sh, private networks.
# Needs docker, openssl, keytool, gpg, python3.
set -euo pipefail

GATEWAY_IMAGE=""
BROKER_IMAGE=""
SENDER_IMAGE=""
STUB_IMAGE=""
PROXY_IMAGE="ubuntu/squid:6.6-24.04_edge"
JDK_IMAGE="maven:3.9-eclipse-temurin-17"
KEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gateway-image) GATEWAY_IMAGE="$2"; shift 2 ;;
    --broker-image)  BROKER_IMAGE="$2"; shift 2 ;;
    --sender-image)  SENDER_IMAGE="$2"; shift 2 ;;
    --stub-image)    STUB_IMAGE="$2"; shift 2 ;;
    --proxy-image)   PROXY_IMAGE="$2"; shift 2 ;;
    --jdk-image)     JDK_IMAGE="$2"; shift 2 ;;
    --keep)          KEEP=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$GATEWAY_IMAGE" && -n "$BROKER_IMAGE" && -n "$SENDER_IMAGE" && -n "$STUB_IMAGE" ]] \
  || { echo "--gateway-image, --broker-image, --sender-image and --stub-image are required" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_ID="lemr-path-$$"
WORK="$(mktemp -d)"
CENTRAL_HOST="central.liberiaemr.test"
# Central's own network, the "internet" between sites, a facility network, and a facility
# network whose only way out is the forward proxy.
CENTRAL_NET="$RUN_ID-central"
INTERNET="$RUN_ID-internet"
FACILITY_NET="$RUN_ID-facility"
PROXIED_NET="$RUN_ID-proxied"
BROKER="$RUN_ID-broker"
STUB="$RUN_ID-stub"
GATEWAY="$RUN_ID-gateway"
SERVER="$RUN_ID-tunnel-server"
CLIENT="$RUN_ID-tunnel-client"
PROXIED_CLIENT="$RUN_ID-tunnel-proxied"
PROXY="$RUN_ID-proxy"

cleanup() {
  docker rm -fv "$RUN_ID-rogue" "$RUN_ID-tunnel-bad" "$CLIENT" "$PROXIED_CLIENT" "$PROXY" "$SERVER" "$GATEWAY" "$BROKER" "$STUB" >/dev/null 2>&1 || true
  for net in "$CENTRAL_NET" "$INTERNET" "$FACILITY_NET" "$PROXIED_NET"; do
    docker network rm "$net" >/dev/null 2>&1 || true
  done
  if [[ "$KEEP" == "true" ]]; then echo "kept $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }
logs_have() { local out; out="$(docker logs "$1" 2>&1 || true)"; grep -q "$2" <<<"$out"; }

echo "== the tunnel services, as the compose files define them =="
printf 'ARTEMIS_BIND_ADDR=192.0.2.10\nTLS_CERT_DIR=/nonexistent\n' > "$WORK/override.env"
docker compose -f "$ROOT/distribution/compose/central/docker-compose.yml" \
  --env-file "$ROOT/distribution/env/central.env.example" --env-file "$WORK/override.env" \
  config --format json > "$WORK/central.json"
docker compose -f "$ROOT/distribution/compose/facility/docker-compose.yml" \
  --env-file "$ROOT/distribution/env/facility.env.example" --env-file "$WORK/override.env" \
  --profile sync config --format json > "$WORK/facility.json"
# The image and the command, one argument per line; compose escapes $ as $$ in its output.
service() { # stack field
  python3 - "$WORK/$1.json" "$2" <<'PY'
import json, sys
svc = json.load(open(sys.argv[1]))["services"]["sync-tunnel"]
if sys.argv[2] == "image":
    print(svc["image"])
else:
    for arg in svc["command"]:
        print(arg.replace("$$", "$"))
PY
}
TUNNEL_IMAGE="$(service central image)"
[[ "$(service facility image)" == "$TUNNEL_IMAGE" ]] || fail "both ends run the same tunnel image"
# A read loop rather than mapfile, which the bash on macOS lacks.
SERVER_CMD=(); while IFS= read -r line; do SERVER_CMD+=("$line"); done < <(service central command)
# The facility's command is sh -c and a multi-line script: keep the script as one argument.
CLIENT_CMD=()
{ IFS= read -r a; IFS= read -r b; CLIENT_CMD=("$a" "$b" "$(cat)"); } < <(service facility command)
pass "both stacks define the tunnel, on $TUNNEL_IMAGE"

echo "== issuing throwaway security material =="
"$ROOT/scripts/security/gen-sync-certs.sh" --out "$WORK/pki" --broker-host "$CENTRAL_HOST" \
  --facilities careysburg,barnersville,revokedfac --revoke revokedfac >/dev/null
# Central's web certificate from its own CA, which the tunnel must be told to trust, as a site
# behind an inspecting firewall would be.
mkdir -p "$WORK/web"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=LiberiaEMR QA web CA" \
  -keyout "$WORK/web/ca.key" -out "$WORK/web/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=$CENTRAL_HOST" \
  -keyout "$WORK/web/privkey.pem" -out "$WORK/web/web.csr" 2>/dev/null
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$CENTRAL_HOST" > "$WORK/web/ext"
openssl x509 -req -days 2 -in "$WORK/web/web.csr" -CA "$WORK/web/ca.pem" -CAkey "$WORK/web/ca.key" \
  -set_serial 1 -extfile "$WORK/web/ext" -out "$WORK/web/fullchain.pem" 2>/dev/null
chmod -R a+rX "$WORK"

echo "== compiling the probe against the sender's own libraries =="
mkdir -p "$WORK/probe"
cid="$(docker create "$SENDER_IMAGE")"
docker cp "$cid:/app/sender.jar" "$WORK/probe/sender.jar" >/dev/null
docker rm "$cid" >/dev/null
docker run --rm --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$WORK/probe:/probe" -v "$ROOT/qa/sync/probes:/src:ro" "$JDK_IMAGE" \
  -c 'cd /probe && jar xf sender.jar BOOT-INF/lib BOOT-INF/classpath.idx && mkdir -p classes \
      && cp="$(sed -n "s|^- \"\(.*\)\"$|/work/probe/\1|p" BOOT-INF/classpath.idx | paste -sd: -)" \
      && printf "%s\n" "-cp" "/work/probe/classes:$cp" > cp.args \
      && javac -nowarn -d classes -cp "$(echo "$cp" | sed "s|/work/probe/||g")" /src/*.java'
chmod -R a+rX "$WORK/probe"

echo "== central: broker, tunnel server and gateway; 61617 is on no network a facility shares =="
for net in "$CENTRAL_NET" "$INTERNET" "$FACILITY_NET" "$PROXIED_NET"; do docker network create "$net" >/dev/null; done
docker run -d --name "$BROKER" --network "$CENTRAL_NET" --network-alias artemis \
  -v "$WORK/pki/broker:/etc/broker-certs:ro" "$BROKER_IMAGE" >/dev/null
docker run -d --name "$STUB" --user 0 --network "$CENTRAL_NET" --network-alias frontend --network-alias backend \
  --entrypoint sh "$STUB_IMAGE" -c 'mkdir -p /www/openmrs && echo "backend ok" > /www/openmrs/health \
    && httpd -p 80 -h /www && exec httpd -f -p 8080 -h /www' >/dev/null
docker run -d --name "$SERVER" --network "$CENTRAL_NET" --network-alias sync-tunnel \
  "$TUNNEL_IMAGE" "${SERVER_CMD[@]}" >/dev/null
docker run -d --name "$GATEWAY" --network "$CENTRAL_NET" -v "$WORK/web:/etc/nginx/certs:ro" "$GATEWAY_IMAGE" >/dev/null
docker network connect --alias "$CENTRAL_HOST" "$INTERNET" "$GATEWAY"
for _ in $(seq 1 60); do
  logs_have "$BROKER" 'AMQ221007' && break
  docker ps -q --filter "name=^$BROKER$" | grep . >/dev/null || break
  sleep 2
done
logs_have "$BROKER" 'AMQ221007' || fail "the broker becomes active" "$(docker logs --tail 40 "$BROKER" 2>&1)"

echo "== facility: the tunnel client answers as artemis =="
client() { # name network extra-docker-args...
  local name="$1" net="$2"; shift 2
  docker run -d --name "$name" --network "$net" --network-alias artemis \
    -e SYNC_CENTRAL_URL="https://$CENTRAL_HOST" -v "$WORK/web/ca.pem:/etc/liberiaemr/extra-ca.pem:ro" \
    "$@" "$TUNNEL_IMAGE" "${CLIENT_CMD[@]}" >/dev/null
}
client "$CLIENT" "$FACILITY_NET"
docker network connect "$INTERNET" "$CLIENT"

tls_for() {
  printf '%s\n' "-Djavax.net.ssl.trustStore=/work/pki/$1/truststore.p12" \
    -Djavax.net.ssl.trustStoreType=PKCS12 \
    "-Djavax.net.ssl.trustStorePassword=$(cat "$WORK/pki/$1/truststore.pass")" \
    "-Djavax.net.ssl.keyStore=/work/pki/$1/client.p12" \
    -Djavax.net.ssl.keyStoreType=PKCS12 \
    "-Djavax.net.ssl.keyStorePassword=$(cat "$WORK/pki/$1/client.pass")"
}
probe() { # network identity probe-args...
  local net="$1" identity="$2"; shift 2
  local tls=() line
  while IFS= read -r line; do tls+=("$line"); done < <(tls_for "$identity")
  docker run --rm --network "$net" -v "$WORK:/work:ro" "$JDK_IMAGE" \
    java "${tls[@]}" @/work/probe/cp.args OpenWireProbe "$@" 2>&1 || true
}
check() { # name want-regex veto-regex output
  local result
  result="$(grep -m1 '^RESULT' <<<"$4" || echo 'RESULT <none>')"
  if ! grep -qE "$2" <<<"$result" || { [[ -n "$3" ]] && grep -qE "$3" <<<"$result"; }; then
    fail "$1" "expected /$2/ got: ${result:0:400}" "tunnel: $(docker logs --tail 5 "$CLIENT" 2>&1 | tr '\n' ' ')"
  fi
  pass "$1"
}
# The sender's own URL: sync-security.sh appends exactly these options.
URL="ssl://artemis:61617?socket.verifyHostName=true&jms.watchTopicAdvisories=false"

# The first connection waits for the tunnel to come up.
out=""
for _ in $(seq 1 10); do
  out="$(probe "$FACILITY_NET" facility-careysburg "$URL" send sync.facility.careysburg)"
  grep -q '^RESULT SENT' <<<"$out" && break
  sleep 3
done
check "an enrolled facility sends through https://$CENTRAL_HOST/sync/broker/" 'RESULT SENT' '' "$out"
check "the broker still checks permissions through the path (D6)" 'RESULT REFUSED' 'SENT' \
  "$(probe "$FACILITY_NET" facility-careysburg "$URL" send sync.facility.barnersville)"
check "a revoked certificate is refused through the path (D8)" 'RESULT (FAILED|REFUSED)' 'SENT' \
  "$(probe "$FACILITY_NET" facility-revokedfac "$URL" send sync.facility.revokedfac)"

# Nothing at the facility end can reach 61617 itself: the broker is only on central's network.
direct="$(docker run --rm --network "$FACILITY_NET" --entrypoint sh "$STUB_IMAGE" \
  -c "nc -z -w 3 $BROKER 61617 && echo open || echo closed" 2>&1 || true)"
[[ "$direct" == *closed* ]] || fail "the facility has no route to 61617" "got: $direct"
pass "the facility has no route to 61617; the path is the only way in"

access="$(docker logs "$GATEWAY" 2>/dev/null | grep -m1 'GET /sync/broker/events' || true)"
[[ -n "$access" && "$access" == *' 101 '* ]] \
  || fail "the gateway logs each tunnel, upgraded, with the facility's address" "log line: ${access:-<none>}"
pass "the gateway logs each tunnel, upgraded, with the facility's address"

echo "== a facility that can only leave through a forward proxy =="
docker run -d --name "$PROXY" --network "$INTERNET" "$PROXY_IMAGE" >/dev/null
docker network connect "$PROXIED_NET" "$PROXY"
client "$PROXIED_CLIENT" "$PROXIED_NET" -e SYNC_HTTP_PROXY="$PROXY:3128"
out=""
for _ in $(seq 1 20); do
  out="$(probe "$PROXIED_NET" facility-barnersville "$URL" send sync.facility.barnersville)"
  grep -q '^RESULT SENT' <<<"$out" && break
  sleep 3
done
check "a facility behind an HTTP CONNECT proxy sends through it" 'RESULT SENT' '' "$out"
proxy_log="$(docker logs "$PROXY" 2>&1; docker exec "$PROXY" sh -c 'cat /var/log/squid/access.log 2>/dev/null' || true)"
grep -q "CONNECT $CENTRAL_HOST:443" <<<"$proxy_log" \
  || fail "the proxied tunnel went through the proxy" "$(docker logs --tail 10 "$PROXY" 2>&1)"
pass "the proxied tunnel went through the proxy, as CONNECT $CENTRAL_HOST:443"

echo "== refusals at the tunnels themselves =="
# The central tunnel forwards to the broker and nowhere else.
docker run -d --name "$RUN_ID-rogue" --network "$INTERNET" --entrypoint /home/app/wstunnel "$TUNNEL_IMAGE" \
  client -L tcp://0.0.0.0:9000:backend:8080 --http-upgrade-path-prefix sync/broker \
  "wss://$CENTRAL_HOST" >/dev/null
sleep 3
rogue="$(docker run --rm --network "$INTERNET" --entrypoint sh "$STUB_IMAGE" \
  -c "wget -qO- -T 5 http://$RUN_ID-rogue:9000/openmrs/health 2>&1 || true")"
docker rm -f "$RUN_ID-rogue" >/dev/null 2>&1 || true
[[ "$rogue" != *"backend ok"* ]] || fail "the central tunnel refuses any destination but the broker" "reached: $rogue"
pass "the central tunnel refuses any destination but the broker"

bad="$RUN_ID-tunnel-bad"
docker run -d --name "$bad" -e SYNC_CENTRAL_URL="http://$CENTRAL_HOST" "$TUNNEL_IMAGE" "${CLIENT_CMD[@]}" >/dev/null
sleep 3
running="$(docker inspect -f '{{.State.Running}}' "$bad" 2>/dev/null || echo false)"
logs_have "$bad" 'must start with https://' || running=true
docker rm -f "$bad" >/dev/null 2>&1 || true
[[ "$running" == false ]] || fail "the facility tunnel refuses a plain http central address"
pass "the facility tunnel refuses a plain http central address"

echo "PASS: all $PASSES sync-over-HTTPS checks held"
