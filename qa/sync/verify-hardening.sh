#!/usr/bin/env bash
# QA refusal suite for the sync broker and payload encryption (sync-eip.md 7.2, 7.3, 7.7;
# SOP controls D2, D6, D8; risks E7, E11). Every control is proven by a refusal from a real
# certificate, over OpenWire, the protocol both sync apps use.
#
#   qa/sync/verify-hardening.sh --broker-image <image> --sender-image <image> \
#     --exporter-image <image> [--jdk-image maven:3.9-eclipse-temurin-17] [--keep]
#
# Self-contained: issues throwaway material with scripts/security/gen-sync-certs.sh, starts
# the broker on a private network, and drives it with the Java probes in qa/sync/probes,
# compiled against the libraries inside the sender image. Needs docker, openssl, keytool, gpg.
set -euo pipefail

BROKER_IMAGE=""
SENDER_IMAGE=""
EXPORTER_IMAGE=""
JDK_IMAGE="maven:3.9-eclipse-temurin-17"
KEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --broker-image) BROKER_IMAGE="$2"; shift 2 ;;
    --sender-image) SENDER_IMAGE="$2"; shift 2 ;;
    --exporter-image) EXPORTER_IMAGE="$2"; shift 2 ;;
    --jdk-image)    JDK_IMAGE="$2"; shift 2 ;;
    --keep)         KEEP=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BROKER_IMAGE" && -n "$SENDER_IMAGE" && -n "$EXPORTER_IMAGE" ]] \
  || { echo "--broker-image, --sender-image and --exporter-image are required" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_ID="lemr-hardening-$$"
WORK="$(mktemp -d)"
NET="$RUN_ID"
BROKER="$RUN_ID-broker"
EXPORTER="$RUN_ID-exporter"
ADMIN_CLI=/opt/liberiaemr-broker/bin/artemis

cleanup() {
  docker rm -fv "$BROKER" "$EXPORTER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  if [[ "$KEEP" == "true" ]]; then echo "kept $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# Captures before matching: grep -q on a live pipe can SIGPIPE docker under pipefail.
logs_have() { local out; out="$(docker logs "$1" 2>&1 || true)"; grep -q "$2" <<<"$out"; }

echo "== issuing throwaway security material =="
"$ROOT/scripts/security/gen-sync-certs.sh" --out "$WORK/pki" --broker-host artemis \
  --facilities careysburg,careys,barnersville,revokedfac --revoke revokedfac >/dev/null
mkdir -p "$WORK/rogue"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=Rogue CA" \
  -keyout "$WORK/rogue/ca.key" -out "$WORK/rogue/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/C=LR/O=MOH LiberiaEMR/CN=careysburg" \
  -keyout "$WORK/rogue/client.key" -out "$WORK/rogue/client.csr" 2>/dev/null
openssl x509 -req -days 2 -in "$WORK/rogue/client.csr" -CA "$WORK/rogue/ca.pem" \
  -CAkey "$WORK/rogue/ca.key" -set_serial 7 -out "$WORK/rogue/client.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$WORK/rogue/client.key" -in "$WORK/rogue/client.pem" \
  -out "$WORK/rogue/client.p12" -passout pass:rogue
chmod -R a+rX "$WORK"

echo "== compiling the probes against the sender's own libraries =="
mkdir -p "$WORK/probe"
cid="$(docker create "$SENDER_IMAGE")"
docker cp "$cid:/app/sender.jar" "$WORK/probe/sender.jar" >/dev/null
docker rm "$cid" >/dev/null
# Classpath in classpath.idx order, as Spring Boot loads it: the jar carries two
# BouncyCastle generations, and another order fails jar signature checks. Runs as the
# caller so the output stays removable on Linux.
docker run --rm --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$WORK/probe:/probe" -v "$ROOT/qa/sync/probes:/src:ro" "$JDK_IMAGE" \
  -c 'cd /probe && jar xf sender.jar BOOT-INF/lib BOOT-INF/classpath.idx && mkdir -p classes \
      && cp="$(sed -n "s|^- \"\(.*\)\"$|/work/probe/\1|p" BOOT-INF/classpath.idx | paste -sd: -)" \
      && printf "%s\n" "-cp" "/work/probe/classes:$cp" > cp.args \
      && javac -nowarn -d classes -cp "$(echo "$cp" | sed "s|/work/probe/||g")" /src/*.java'
chmod -R a+rX "$WORK/probe"

echo "== starting the broker =="
docker network create "$NET" >/dev/null
docker run -d --name "$BROKER" --restart unless-stopped --network "$NET" --network-alias artemis --network-alias wrongname \
  -v "$WORK/pki/broker:/etc/broker-certs:ro" -v "$WORK/pki/admin:/admin:ro" "$BROKER_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  logs_have "$BROKER" 'AMQ221007' && break
  docker ps -q --filter "name=^$BROKER$" | grep . >/dev/null || break
  sleep 2
done
logs_have "$BROKER" 'AMQ221007' || { echo "FAIL: broker did not become active" >&2; docker logs --tail 40 "$BROKER" >&2; exit 1; }
# The exporter mounts public/ as the central compose does, refreshing every 2s.
docker run -d --name "$EXPORTER" -e REFRESH_SECONDS=2 -v "$WORK/pki/broker/public:/public:ro" "$EXPORTER_IMAGE" >/dev/null

URL_OPTS="socket.verifyHostName=true&jms.watchTopicAdvisories=false"
URL="ssl://artemis:61617?$URL_OPTS"
TOPIC=openmrs.sync.topic
REC_CLIENT=DB-SYNC-REC
REC_SUB=DB-SYNC-RECEIVER

# JVM TLS settings for an identity under pki/, "rogue", or "none" (no client certificate).
tls_for() {
  printf '%s\n' -Djavax.net.ssl.trustStore=/work/pki/receiver/truststore.p12 \
    -Djavax.net.ssl.trustStoreType=PKCS12 \
    "-Djavax.net.ssl.trustStorePassword=$(cat "$WORK/pki/receiver/truststore.pass")"
  case "$1" in
    none)  ;;
    rogue) printf '%s\n' -Djavax.net.ssl.keyStore=/work/rogue/client.p12 \
             -Djavax.net.ssl.keyStoreType=PKCS12 -Djavax.net.ssl.keyStorePassword=rogue ;;
    *)     printf '%s\n' "-Djavax.net.ssl.keyStore=/work/pki/$1/client.p12" \
             -Djavax.net.ssl.keyStoreType=PKCS12 \
             "-Djavax.net.ssl.keyStorePassword=$(cat "$WORK/pki/$1/client.pass")" ;;
  esac
}

probe() { # identity probe-args...
  local identity="$1"; shift
  local tls=() line
  while IFS= read -r line; do tls+=("$line"); done < <(tls_for "$identity")
  docker run --rm --network "$NET" -v "$WORK:/work:ro" "$JDK_IMAGE" \
    java "${tls[@]}" @/work/probe/cp.args OpenWireProbe "$@" 2>&1 || true
}

# Operators use the CORE CLI on the loopback admin acceptor, inside the broker container.
# Host name checks add nothing on the container's own loopback, so they are off there only.
admin_queue_count() { # queue
  local ks ts out
  ks="$(cat "$WORK/pki/admin/client.pass")"
  ts="$(cat "$WORK/pki/admin/truststore.pass")"
  out="$(docker exec "$BROKER" "$ADMIN_CLI" queue stat --silent --queueName "$1" --url \
    "tcp://127.0.0.1:61618?sslEnabled=true;verifyHost=false;keyStorePath=/admin/client.p12;keyStorePassword=$ks;trustStorePath=/admin/truststore.p12;trustStorePassword=$ts" 2>&1 || true)"
  awk -F'|' -v q="$1" '{gsub(/ /,"",$2); gsub(/ /,"",$5)} $2==q {print $5}' <<<"$out"
}

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
check() { # name want-regex veto-regex output
  local name="$1" want="$2" veto="$3" out="$4" result
  result="$(grep -m1 '^RESULT' <<<"$out" || echo 'RESULT <none>')"
  if ! grep -qE "$want" <<<"$result" || { [[ -n "$veto" ]] && grep -qE "$veto" <<<"$result"; }; then
    echo "FAIL [$name]" >&2
    echo "    expected /$want/ got: ${result:0:400}" >&2
    exit 1
  fi
  pass "$name"
}

check "no plain listener" 'RESULT FAILED' 'SENT' \
  "$(probe facility-careysburg "tcp://artemis:61616?$URL_OPTS" send sync.facility.careysburg)"

check "facility can send before the receiver has ever connected" 'RESULT SENT' '' \
  "$(probe facility-careysburg "$URL" send sync.facility.careysburg)"
check "receiver still gets it: the broker kept it for the subscription (E11)" 'RESULT RECEIVED' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 30)"

check "facility cannot send to another facility's address (D6)" 'RESULT REFUSED' 'SENT' \
  "$(probe facility-careysburg "$URL" send sync.facility.barnersville)"
check "facility cannot send to the sync topic directly (D6)" 'RESULT REFUSED' 'SENT' \
  "$(probe facility-careysburg "$URL" send "$TOPIC")"
check "facility cannot consume the sync topic (E7)" 'RESULT REFUSED' 'CONSUMER_CREATED' \
  "$(probe facility-careysburg "$URL" consume "$TOPIC")"
check "facility cannot open its own subscription (E7)" 'RESULT REFUSED' 'RECEIVED|NO_MESSAGE' \
  "$(probe facility-careysburg "$URL" subscribe "$TOPIC" IMPOSTOR IMPOSTOR 5)"
check "facility cannot read the receiver's subscription (E7)" 'RESULT REFUSED' 'RECEIVED|NO_MESSAGE' \
  "$(probe facility-careysburg "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 5)"

check "no client certificate is refused (D2)" 'RESULT (FAILED|REFUSED)' 'SENT' \
  "$(probe none "$URL" send sync.facility.careysburg)"
check "certificate from an unknown CA is refused (D2)" 'RESULT (FAILED|REFUSED)' 'SENT' \
  "$(probe rogue "$URL" send sync.facility.careysburg)"
check "certificate on the revocation list is refused (D8)" 'RESULT (FAILED|REFUSED)' 'SENT' \
  "$(probe facility-revokedfac "$URL" send sync.facility.revokedfac)"
check "broker reached by a name not in its certificate is refused" 'RESULT FAILED' 'SENT' \
  "$(probe facility-careysburg "ssl://wrongname:61617?$URL_OPTS" send sync.facility.careysburg)"
# Operator sessions keep running on the loopback acceptor while the admin certificate tries 61617.
( for _ in $(seq 1 10); do admin_queue_count DLQ >/dev/null; sleep 1; done ) &
admin_loop=$!
sleep 3
check "admin certificate cannot log in on the facility port, even during admin use" \
  'RESULT REFUSED.*(AMQ229031|Unable to validate)' 'SENT' \
  "$(probe admin "$URL" send DLA)"
wait "$admin_loop" || true

tls11="$(docker run --rm --network "$NET" --entrypoint sh "$EXPORTER_IMAGE" -c \
  'openssl s_client -connect artemis:61617 -tls1_1 -cipher "DEFAULT:@SECLEVEL=0" </dev/null 2>&1' || true)"
if grep -qiE 'alert protocol version|unsupported protocol|wrong version number' <<<"$tls11" \
   && ! grep -q 'no protocols available' <<<"$tls11"; then
  pass "the broker refuses TLS 1.1 (D1 floor is TLS 1.2)"
else
  echo "FAIL [broker refuses TLS 1.1]" >&2
  grep -m3 -iE 'alert|protocol|error|CONNECTED' <<<"$tls11" | sed 's/^/    /' >&2
  exit 1
fi

check "second facility can send to its own address" 'RESULT SENT' '' \
  "$(probe facility-barnersville "$URL" send sync.facility.barnersville)"
check "receiver gets the second facility's message too" 'RESULT RECEIVED' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 30)"
grep -v '^barnersville=' "$WORK/pki/broker/cert-users.properties" > "$WORK/users.tmp"
cat "$WORK/users.tmp" > "$WORK/pki/broker/cert-users.properties"
sleep 2 # the identity mapping reloads on its next modification-time check
check "facility removed from the enrolment is refused" 'RESULT REFUSED' 'SENT' \
  "$(probe facility-barnersville "$URL" send sync.facility.barnersville)"

pgp() { # facility claimed-facility [receiver-keys-dir relative to /work]
  local keys="${3:-/pki/receiver/pgp}"
  # dbsync resolves key folders against its working directory, as in the images.
  docker run --rm -w /work -v "$WORK:/work:ro" "$JDK_IMAGE" \
    java @/work/probe/cp.args PgpRoundTrip \
    "/pki/facility-$1/pgp" "$(cat "$WORK/pki/facility-$1/pgp.pass")" "$1@sync.liberiaemr" \
    "$keys" "$(cat "$WORK/pki/receiver/pgp.pass")" "sync-receiver@sync.liberiaemr" \
    "$2@sync.liberiaemr" 2>&1 || true
}
check "PGP: an enrolled facility's payload verifies and decrypts" 'RESULT VERIFIED' '' "$(pgp careysburg careysburg)"
check "PGP: a facility id that prefixes another does not collide" 'RESULT VERIFIED' '' "$(pgp careys careys)"
check "PGP: a sender header naming another facility is rejected" 'RESULT REJECTED' 'VERIFIED' "$(pgp careysburg barnersville)"
mkdir -p "$WORK/unenrolled-pgp"
cp "$WORK/pki/receiver/pgp/sync-receiver-sec.asc" "$WORK/pki/receiver/pgp/barnersville-pub.asc" "$WORK/unenrolled-pgp/"
chmod -R a+rX "$WORK/unenrolled-pgp"
check "PGP: a facility whose key the receiver does not hold is rejected" 'RESULT REJECTED' 'VERIFIED' \
  "$(pgp careysburg careysburg /unenrolled-pgp)"

# A receiver that crashes on a message never acknowledges it. After max-delivery-attempts
# the broker must move it to the dead-letter queue, not delete it.
check "a message for the dead-letter test is sent" 'RESULT SENT' '' \
  "$(probe facility-careysburg "$URL" send sync.facility.careysburg)"
check "an unacknowledged message is withdrawn after 10 delivery attempts" 'RESULT WITHDRAWN_AFTER 10' '' \
  "$(probe receiver "$URL" abandon "$TOPIC" "$REC_CLIENT" "$REC_SUB" 12)"
dlq="$(admin_queue_count DLQ)"
if [[ "$dlq" == "1" ]]; then
  pass "it is kept in the dead-letter queue, reachable on the admin acceptor"
else
  echo "FAIL [dead-letter queue holds the message]: DLQ count '$dlq'" >&2
  exit 1
fi
metrics="$(docker run --rm --network "$NET" --entrypoint curl "$JDK_IMAGE" -fsS http://artemis:8161/metrics/ 2>&1 || true)"
if grep -E '^artemis_message_count\{.*queue="DLQ".*\} 1(\.0)?$' <<<"$metrics" >/dev/null; then
  pass "the broker's metrics report the dead letter, for the SyncDeadLetters alert"
else
  echo "FAIL [broker metrics report the dead letter]" >&2
  grep -m3 'DLQ\|artemis_message_count' <<<"$metrics" | sed 's/^/    /' >&2
  exit 1
fi
# The store passwords reach the container through the environment rather than the docker command
# line, the same way scripts/sync/broker-admin.sh does it.
admin_exec() { # shell body using $url and $CLI, then its arguments
  docker exec -e LEMR_KS="$(cat "$WORK/pki/admin/client.pass")" -e LEMR_TS="$(cat "$WORK/pki/admin/truststore.pass")" \
    "$BROKER" sh -c "CLI=$ADMIN_CLI
url=\"tcp://127.0.0.1:61618?sslEnabled=true;verifyHost=false;keyStorePath=/admin/client.p12;keyStorePassword=\$LEMR_KS;trustStorePath=/admin/truststore.p12;trustStorePassword=\$LEMR_TS\"
$1" sh "${@:2}"
}
admin_exec 'exec "$CLI" transfer --source-queue DLA::DLQ --target-topic "$1" --source-url "$url" --target-url "$url"' \
  "$TOPIC" >/dev/null 2>&1 || true
check "an operator can replay the dead letter to the receiver" 'RESULT RECEIVED' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 30)"

# Before a compromised facility's key is removed, its queued messages are exported, leaving the rest.
check "a message from one facility waits for the receiver" 'RESULT SENT' '' \
  "$(probe facility-careysburg "$URL" send sync.facility.careysburg)"
check "and one from another" 'RESULT SENT' '' "$(probe facility-careys "$URL" send sync.facility.careys)"
admin_exec 'exec "$CLI" consumer --destination "$1" --filter "$2" --break-on-null --receive-timeout 3000 \
  --data /tmp/export.xml --url "$url"' \
  "queue://$TOPIC::$REC_CLIENT.$REC_SUB" "_AMQ_VALIDATED_USER='careys'" >/dev/null 2>&1 || true
exported="$(docker exec "$BROKER" cat /tmp/export.xml 2>/dev/null || true)"
if [[ "$(grep -c 'name="_AMQ_VALIDATED_USER" value="careys"' <<<"$exported")" == "1" ]] \
   && ! grep -q 'value="careysburg"' <<<"$exported"; then
  pass "an operator can export one facility's queued messages"
else
  echo "FAIL [operator exports one facility's queued messages]: ${exported:0:300}" >&2
  exit 1
fi
check "the other facility's message is still delivered to the receiver" 'RESULT RECEIVED' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 30)"
check "and nothing else is left for it" 'RESULT NO_MESSAGE' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 5)"

# Revoking a live facility: replace crl.pem the way operators are told to, and the broker
# must restart itself and refuse the certificate without anyone touching it.
check "a facility is accepted before its revocation" 'RESULT SENT' '' \
  "$(probe facility-careys "$URL" send sync.facility.careys)"
check "receiver takes that message" 'RESULT RECEIVED' '' \
  "$(probe receiver "$URL" subscribe "$TOPIC" "$REC_CLIENT" "$REC_SUB" 30)"
exporter_crl_update() {
  docker exec "$EXPORTER" wget -qO- http://127.0.0.1:9101/metrics 2>/dev/null \
    | awk '$1=="sync_crl_last_update_seconds" {print $2}'
}
crl_before="$(exporter_crl_update)"
sleep 2 # the new list's lastUpdate must differ by at least a second
openssl ca -config "$WORK/pki/ca/openssl.cnf" -revoke "$WORK/pki/facility-careys/client.pem" 2>/dev/null
openssl ca -config "$WORK/pki/ca/openssl.cnf" -gencrl -out "$WORK/crl.new" 2>/dev/null
chmod a+r "$WORK/crl.new"
mv "$WORK/crl.new" "$WORK/pki/broker/public/crl.pem"
broker_starts() { local out; out="$(docker logs "$BROKER" 2>&1 || true)"; grep -c AMQ221007 <<<"$out" || true; }
active=""
for _ in $(seq 1 60); do
  [[ "$(broker_starts)" -ge 2 ]] && { active=1; break; }
  sleep 2
done
[[ -n "$active" ]] && logs_have "$BROKER" 'revocation list changed' \
  || { echo "FAIL [broker restarts itself, through its restart policy, on a new revocation list]" >&2; exit 1; }
pass "the broker restarts itself, through its restart policy, on a new revocation list"
check "an enrolled facility is accepted after the restart" 'RESULT SENT' '' \
  "$(probe facility-careysburg "$URL" send sync.facility.careysburg)"
crl_after=""
for _ in $(seq 1 10); do
  crl_after="$(exporter_crl_update)"
  [[ -n "$crl_after" && "$crl_after" != "$crl_before" ]] && break
  sleep 1
done
if [[ -n "$crl_before" && -n "$crl_after" && "$crl_after" != "$crl_before" ]]; then
  pass "the expiry exporter sees the replaced revocation list"
else
  echo "FAIL [exporter sees the replaced revocation list]: before '$crl_before' after '$crl_after'" >&2
  exit 1
fi
check "the newly revoked facility is refused (D8)" 'RESULT (FAILED|REFUSED)' 'SENT' \
  "$(probe facility-careys "$URL" send sync.facility.careys)"

# A revocation list from another issuer would lock out every client; it must not be loaded.
mkdir -p "$WORK/rogue/ca-db"
: > "$WORK/rogue/ca-db/index.txt"
echo 1000 > "$WORK/rogue/ca-db/crlnumber"
printf '[ ca ]\ndefault_ca = r\n[ r ]\ndatabase = %s\ncrlnumber = %s\ncertificate = %s\nprivate_key = %s\ndefault_md = sha256\ndefault_crl_days = 30\n' \
  "$WORK/rogue/ca-db/index.txt" "$WORK/rogue/ca-db/crlnumber" "$WORK/rogue/ca.pem" "$WORK/rogue/ca.key" > "$WORK/rogue/ca.cnf"
openssl ca -config "$WORK/rogue/ca.cnf" -gencrl -out "$WORK/crl.rogue" 2>/dev/null
cp "$WORK/pki/broker/public/crl.pem" "$WORK/crl.good"
chmod a+r "$WORK/crl.rogue" "$WORK/crl.good"
mv "$WORK/crl.rogue" "$WORK/pki/broker/public/crl.pem"
sleep 12
valid=""
for _ in $(seq 1 10); do
  valid="$(docker exec "$EXPORTER" wget -qO- http://127.0.0.1:9101/metrics 2>/dev/null | awk '$1=="sync_crl_valid" {print $2}')"
  [[ "$valid" == "0" ]] && break
  sleep 1
done
if [[ "$(broker_starts)" -eq 2 ]] && logs_have "$BROKER" 'does not verify against the CA' && [[ "$valid" == "0" ]]; then
  pass "a revocation list from another issuer is not loaded, and the exporter flags it"
else
  echo "FAIL [foreign revocation list refused]: starts=$(broker_starts) exporter valid='$valid'" >&2
  exit 1
fi
mv "$WORK/crl.good" "$WORK/pki/broker/public/crl.pem"

# The identity stamp is visible only on the broker, so it is read from the journal.
check "one more message waits for the offline receiver" 'RESULT SENT' '' \
  "$(probe facility-careysburg "$URL" send sync.facility.careysburg)"
docker stop "$BROKER" >/dev/null
journal="$(docker run --rm --volumes-from "$BROKER" --entrypoint "$ADMIN_CLI" "$BROKER_IMAGE" \
  data print --journal /var/lib/artemis-data/journal --bindings /var/lib/artemis-data/bindings \
  --paging /var/lib/artemis-data/paging --large-messages /var/lib/artemis-data/large-messages 2>&1 || true)"
if grep -q '_AMQ_VALIDATED_USER=careysburg' <<<"$journal"; then
  pass "the broker records the certificate identity that sent each message"
else
  echo "FAIL [identity stamp in the journal]" >&2
  grep -m3 -iE 'VALIDATED|Exception' <<<"$journal" | sed 's/^/    /' >&2
  exit 1
fi

echo
echo "PASS: all $PASSES hardening checks held."
