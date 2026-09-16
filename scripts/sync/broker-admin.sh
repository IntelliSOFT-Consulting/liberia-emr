#!/usr/bin/env bash
# Runs an Artemis CLI command against the sync broker as an operator: with the admin
# certificate, on the loopback acceptor inside the broker container. The admin keystore is
# never mounted; it is copied into the container for this command and removed afterwards.
#
#   scripts/sync/broker-admin.sh --admin <dir> [--container <name>] <artemis command> [args]
#
#   scripts/sync/broker-admin.sh --admin /secure/broker-admin queue stat --queueName DLQ
#   scripts/sync/broker-admin.sh --admin /secure/broker-admin consumer --destination queue://DLA::DLQ \
#     --break-on-null --receive-timeout 5000 --data ./dead-letters.xml
#   scripts/sync/broker-admin.sh --admin /secure/broker-admin transfer --source-queue DLA::DLQ \
#     --target-topic openmrs.sync.topic --message-count 1
#
# <dir> holds client.p12, client.pass, truststore.p12 and truststore.pass (the admin/
# layout of scripts/security/gen-sync-certs.sh). The command's --url is added here, and the
# store passwords are masked in what the CLI prints. A --data file is written on this host;
# it must not exist yet, and the messages it holds stay in the container until it is written.
set -euo pipefail

ADMIN=""
CONTAINER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin)     ADMIN="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    *) break ;;
  esac
done
[[ -n "$ADMIN" && $# -gt 0 ]] || { echo "usage: $0 --admin <dir> [--container <name>] <artemis command> [args]" >&2; exit 2; }
for f in client.p12 client.pass truststore.p12 truststore.pass; do
  [[ -r "$ADMIN/$f" ]] || { echo "cannot read $ADMIN/$f" >&2; exit 1; }
done
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 -E 'central.*[-_]artemis[-_]' || true)"
  [[ -n "$CONTAINER" ]] || { echo "no running central artemis container; pass --container" >&2; exit 1; }
fi

args=()
export_to=""
SESSION="/tmp/broker-admin-$$"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--data" && $# -gt 1 ]]; then
    export_to="$2"
    args+=(--data "$SESSION/data.xml")
    shift 2
  else
    args+=("$1")
    shift
  fi
done
# Consuming removes the messages from the broker, so the evidence file is checked first.
if [[ -n "$export_to" ]]; then
  [[ ! -e "$export_to" ]] || { echo "$export_to already exists; choose a new file" >&2; exit 1; }
  : > "$export_to" || { echo "cannot write $export_to" >&2; exit 1; }
fi

keep_data=false
cleanup() {
  local remove="$SESSION"
  [[ "$keep_data" == "false" ]] || remove="$SESSION/client.p12 $SESSION/truststore.p12"
  # shellcheck disable=SC2086 # remove is a list of paths without spaces
  docker exec "$CONTAINER" rm -rf $remove >/dev/null 2>&1 \
    || echo "WARNING: could not remove $SESSION from $CONTAINER; it holds the admin keystore, remove it by hand" >&2
}
trap cleanup EXIT

docker exec "$CONTAINER" sh -c "umask 077 && mkdir $SESSION"
for f in client.p12 truststore.p12; do
  docker exec -i "$CONTAINER" sh -c "umask 077 && cat > $SESSION/$f" < "$ADMIN/$f"
done

# The store passwords reach the container through the environment rather than the docker
# command line; the Artemis CLI inside still takes them in its URL while it runs.
LEMR_KS="$(cat "$ADMIN/client.pass")"
LEMR_TS="$(cat "$ADMIN/truststore.pass")"
export LEMR_KS LEMR_TS

# Host name checks add nothing on the container's own loopback, so they are off there only.
status=0
# shellcheck disable=SC2016 # expanded inside the container
docker exec -e LEMR_KS -e LEMR_TS -e SESSION="$SESSION" "$CONTAINER" sh -c '
  url="tcp://127.0.0.1:61618?sslEnabled=true;verifyHost=false;keyStorePath=$SESSION/client.p12;keyStorePassword=$LEMR_KS;trustStorePath=$SESSION/truststore.p12;trustStorePassword=$LEMR_TS"
  if [ "$1" = transfer ]; then
    exec /opt/liberiaemr-broker/bin/artemis "$@" --source-url "$url" --target-url "$url"
  fi
  exec /opt/liberiaemr-broker/bin/artemis "$@" --url "$url"' sh "${args[@]}" 2>&1 \
  | sed -E 's/(keyStorePassword|trustStorePassword)=[^;[:space:]]*/\1=****/g' || status=$?

# Whatever was consumed is written out even if the command failed part way.
if [[ -n "$export_to" ]] && docker exec "$CONTAINER" test -e "$SESSION/data.xml"; then
  if ! docker exec "$CONTAINER" cat "$SESSION/data.xml" > "$export_to"; then
    keep_data=true
    echo "could not write $export_to; the consumed messages are still in $CONTAINER:$SESSION/data.xml" >&2
    exit 1
  fi
elif [[ -n "$export_to" ]]; then
  rm -f "$export_to"
fi
exit "$status"
