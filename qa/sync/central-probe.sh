#!/usr/bin/env bash
# Shared by the QA checks that drive a running central stack as a facility would. Sourced,
# not executed. Expects ROOT, PKI (gen-sync-certs.sh layout), JDK_IMAGE and TIMEOUT to be set.

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

find_container() { docker ps --format '{{.Names}}' | grep -m1 -E "$1" || true; }
ARTEMIS="$(find_container 'central.*[-_]artemis[-_]')"
RECEIVER="$(find_container 'central.*[-_]sync-receiver[-_]')"
[[ -n "$ARTEMIS" && -n "$RECEIVER" ]] || fail "the central artemis and sync-receiver containers are running"
NET="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$ARTEMIS")"

admin() { "$ROOT/scripts/sync/broker-admin.sh" --admin "$PKI/admin" --container "$ARTEMIS" "$@"; }
queue_count() { # queue
  admin queue stat --silent --maxColumnSize -1 --queueName "$1" 2>/dev/null \
    | awk -F'|' -v q="$1" '{gsub(/ /,"",$2); gsub(/ /,"",$5)} $2==q {print $5}'
}

receiver_log() { docker logs --since "$1" "$RECEIVER" 2>&1 || true; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
wait_for_log() { # since pattern
  for _ in $(seq 1 "$TIMEOUT"); do
    receiver_log "$1" | grep -qE "$2" && return 0
    sleep 1
  done
  return 1
}

alert_state() { # alertname prometheus-url
  curl -s "$2/api/v1/alerts" | python3 -c '
import json,sys
print(" ".join(a["state"] for a in json.load(sys.stdin)["data"]["alerts"] if a["labels"].get("alertname") == sys.argv[1]))' "$1" 2>/dev/null || true
}

echo "== compiling the probe against the receiver's own libraries =="
mkdir -p "$WORK/probe"
docker cp "$RECEIVER:/app/receiver.jar" "$WORK/probe/app.jar" >/dev/null
docker run --rm --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$WORK/probe:/probe" -v "$ROOT/qa/sync/probes:/src:ro" "$JDK_IMAGE" \
  -c 'cd /probe && jar xf app.jar BOOT-INF/lib BOOT-INF/classpath.idx && mkdir -p classes \
      && cp="$(sed -n "s|^- \"\(.*\)\"$|/probe/\1|p" BOOT-INF/classpath.idx | paste -sd: -)" \
      && printf "%s\n" "-cp" "/probe/classes:$cp" > cp.args \
      && javac -nowarn -d classes -cp "$cp" /src/OpenWireProbe.java 2>/dev/null'
chmod -R a+rX "$WORK/probe"

# Sends over <connection facility>'s certificate a payload naming <claimed>, signed with
# <key facility>'s PGP key. Prints the probe's RESULT line.
send_as() { # mode connection-facility key-facility claimed [name=value ...]
  local mode="$1" conn="$2" key="$3" claimed="$4"
  shift 4
  # dbsync appends the key folder to the working directory, so it runs from /.
  docker run --rm --network "$NET" -w / -v "$WORK/probe:/probe:ro" -v "$PKI:/pki:ro" "$JDK_IMAGE" \
    java -Djavax.net.ssl.keyStore="/pki/facility-$conn/client.p12" -Djavax.net.ssl.keyStoreType=PKCS12 \
    -Djavax.net.ssl.keyStorePassword="$(cat "$PKI/facility-$conn/client.pass")" \
    -Djavax.net.ssl.trustStore="/pki/facility-$conn/truststore.p12" -Djavax.net.ssl.trustStoreType=PKCS12 \
    -Djavax.net.ssl.trustStorePassword="$(cat "$PKI/facility-$conn/truststore.pass")" \
    @/probe/cp.args OpenWireProbe "ssl://artemis:61617?socket.verifyHostName=true&jms.watchTopicAdvisories=false" \
    "$mode" "sync.facility.$conn" "/pki/facility-$key/pgp" "$(cat "$PKI/facility-$key/pgp.pass")" \
    "$key@sync.liberiaemr" sync-receiver@sync.liberiaemr "$claimed" "$@" > "$WORK/probe.out" 2>&1 || true
  cat "$WORK/probe.out" >> "$WORK/probe.log"
  grep -m1 '^RESULT' "$WORK/probe.out" || echo "RESULT <none>"
}
