#!/usr/bin/env bash
# QA check that alerts reach people, not just the Alertmanager UI (LE-35 acceptance
# criterion 3). Starts Alertmanager with the entrypoint both stacks use, pointed at a
# throwaway SMTP relay (Mailpit, STARTTLS and the exact login required) and a webhook sink,
# raises an alert, and asserts it arrives by email to every recipient and at the webhook.
# Also asserts the entrypoint refuses an incomplete or unsafe email configuration.
#
#   qa/sync/verify-alert-delivery.sh [--alertmanager-image prom/alertmanager:v0.27.0] \
#     [--mailpit-image axllent/mailpit:v1.31.1] [--python-image python:3.12-alpine]
#
# Needs docker, openssl and python3.
set -euo pipefail

AM_IMAGE="prom/alertmanager:v0.27.0"
MAILPIT_IMAGE="axllent/mailpit:v1.31.1"
PYTHON_IMAGE="python:3.12-alpine"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alertmanager-image) AM_IMAGE="$2"; shift 2 ;;
    --mailpit-image)      MAILPIT_IMAGE="$2"; shift 2 ;;
    --python-image)       PYTHON_IMAGE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_ID="lemr-alerts-$$"
NET="$RUN_ID"
AM="$RUN_ID-alertmanager"
MAIL="$RUN_ID-mailpit"
HOOK="$RUN_ID-hook"
ALERT="LemrDeliveryCheck$$"
WORK="$(mktemp -d)"

cleanup() {
  docker rm -fv "$AM" "$MAIL" "$HOOK" "$RUN_ID-refusal" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

PASSES=0
pass() { echo "PASS [$1]"; PASSES=$((PASSES + 1)); }
fail() { echo "FAIL [$1]" >&2; shift; [[ $# -eq 0 ]] || printf '    %s\n' "$@" >&2; exit 1; }

am_run() { # docker-run-args...
  docker run "$@" -v "$ROOT/distribution/monitoring:/etc/amtpl:ro" \
    --entrypoint /bin/sh "$AM_IMAGE" /etc/amtpl/alertmanager-entrypoint.sh
}

# A configuration that is wrongly accepted would run forever, so each case gets 30 seconds.
refuses() { # name expected-message env-args...
  local name="$1" want="$2" container="$RUN_ID-refusal" out
  shift 2
  am_run -d --name "$container" "$@" >/dev/null
  for _ in $(seq 1 30); do
    [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" == "false" ]] && break
    sleep 1
  done
  out="$(docker logs "$container" 2>&1 || true)"
  docker rm -f "$container" >/dev/null 2>&1 || true
  grep -q "$want" <<<"$out" || fail "$name" "expected '$want', got: ${out:0:300}"
  pass "$name"
}

refuses "email without a sender is refused" "ALERT_EMAIL_FROM is not" \
  -e ALERT_EMAIL_TO=ops@example.org -e ALERT_SMTP_SMARTHOST=relay:25
refuses "email without a relay is refused" "ALERT_SMTP_SMARTHOST is not" \
  -e ALERT_EMAIL_TO=ops@example.org -e ALERT_EMAIL_FROM=alerts@example.org
refuses "a relay that is not host:port is refused" "must be host:port" \
  -e ALERT_EMAIL_TO=ops@example.org -e ALERT_EMAIL_FROM=alerts@example.org -e 'ALERT_SMTP_SMARTHOST=relay:25 # x'
refuses "a recipient that could break out of its YAML string is refused" "is not an email address" \
  -e 'ALERT_EMAIL_TO=ops@example.org",x' -e ALERT_EMAIL_FROM=alerts@example.org -e ALERT_SMTP_SMARTHOST=relay:25
refuses "recipients separated by semicolons are refused" "separate addresses with commas" \
  -e 'ALERT_EMAIL_TO=ops@example.org;ict@example.org' -e ALERT_EMAIL_FROM=alerts@example.org -e ALERT_SMTP_SMARTHOST=relay:25
refuses "a value spanning lines is refused" "must be host:port" \
  -e ALERT_EMAIL_TO=ops@example.org -e ALERT_EMAIL_FROM=alerts@example.org -e "ALERT_SMTP_SMARTHOST=relay:25
x: y"
refuses "an SMTP user without a password is refused" "ALERT_SMTP_PASSWORD is not" \
  -e ALERT_EMAIL_TO=ops@example.org -e ALERT_EMAIL_FROM=alerts@example.org -e ALERT_SMTP_SMARTHOST=relay:25 \
  -e ALERT_SMTP_USER=alerts

echo "== starting Mailpit, a webhook sink and Alertmanager =="
# The relay's certificate comes from a throwaway CA that Alertmanager is told to trust, as
# a deployment would for an internal relay.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=QA relay CA" \
  -keyout "$WORK/ca.key" -out "$WORK/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=mailpit" -keyout "$WORK/relay.key" -out "$WORK/relay.csr" 2>/dev/null
printf 'subjectAltName=DNS:mailpit\n' > "$WORK/relay.ext"
openssl x509 -req -days 1 -in "$WORK/relay.csr" -CA "$WORK/ca.pem" -CAkey "$WORK/ca.key" -set_serial 1 \
  -extfile "$WORK/relay.ext" -out "$WORK/relay.pem" 2>/dev/null
SMTP_PASSWORD='p@ss "with" $pecial chars'
# Stored hashed, so the relay's file format cannot bend the password; it must arrive verbatim.
printf 'alerts:{SHA}%s\n' "$(printf '%s' "$SMTP_PASSWORD" | openssl sha1 -binary | base64)" > "$WORK/smtp-auth"
chmod -R a+rX "$WORK"
docker network create "$NET" >/dev/null
docker run -d --name "$MAIL" --network "$NET" --network-alias mailpit -v "$WORK:/qa:ro" \
  -e MP_SMTP_TLS_CERT=/qa/relay.pem -e MP_SMTP_TLS_KEY=/qa/relay.key -e MP_SMTP_REQUIRE_STARTTLS=true \
  -e MP_SMTP_AUTH_FILE=/qa/smtp-auth "$MAILPIT_IMAGE" >/dev/null
docker run -d --name "$HOOK" --network "$NET" --network-alias hook "$PYTHON_IMAGE" python3 -c '
import http.server
class Sink(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        open("/tmp/received", "ab").write(body + b"\n")
        self.send_response(200); self.end_headers()
    def do_GET(self):
        self.send_response(200); self.end_headers()
        try: self.wfile.write(open("/tmp/received", "rb").read())
        except FileNotFoundError: pass
http.server.HTTPServer(("", 8080), Sink).serve_forever()' >/dev/null
am_run -d --name "$AM" --network "$NET" -v "$WORK/ca.pem:/qa/ca.pem:ro" -e SSL_CERT_FILE=/qa/ca.pem \
  -e ALERT_WEBHOOK_URL=http://hook:8080/alerts \
  -e "ALERT_EMAIL_TO=oncall@moh.example, ict-unit@moh.example" -e ALERT_EMAIL_FROM=liberiaemr@moh.example \
  -e ALERT_SMTP_SMARTHOST=mailpit:1025 \
  -e ALERT_SMTP_USER=alerts -e "ALERT_SMTP_PASSWORD=$SMTP_PASSWORD" >/dev/null

ready=""
for _ in $(seq 1 30); do
  docker exec "$AM" wget -qO- http://127.0.0.1:9093/-/ready >/dev/null 2>&1 && { ready=1; break; }
  docker ps -q --filter "name=^$AM$" | grep . >/dev/null || break
  sleep 1
done
[[ -n "$ready" ]] || fail "Alertmanager starts with email and webhook configured" "$(docker logs --tail 20 "$AM" 2>&1)"
pass "Alertmanager starts with email and webhook configured"

docker exec "$AM" amtool --alertmanager.url=http://127.0.0.1:9093 alert add "$ALERT" severity=critical \
  --annotation=summary="Delivery check from qa/sync/verify-alert-delivery.sh" >/dev/null

echo "== waiting for delivery (Alertmanager holds a new group for 30s) =="
mail_recipients() {
  docker run --rm --network "$NET" --entrypoint wget "$PYTHON_IMAGE" -qO- "http://mailpit:8025/api/v1/search?query=subject:$ALERT" 2>/dev/null \
    | python3 -c 'import json,sys
msgs = json.load(sys.stdin).get("messages", [])
print(" ".join(sorted({t["Address"] for m in msgs for t in m["To"]})))' 2>/dev/null || true
}
hook_body() { docker exec "$HOOK" wget -qO- http://127.0.0.1:8080/ 2>/dev/null || true; }

recipients=""
body=""
for _ in $(seq 1 90); do
  recipients="$(mail_recipients)"
  body="$(hook_body)"
  [[ "$recipients" == *ict-unit@moh.example* && "$recipients" == *oncall@moh.example* && "$body" == *"$ALERT"* ]] && break
  sleep 1
done
[[ "$recipients" == "ict-unit@moh.example oncall@moh.example" ]] \
  || fail "the alert is emailed to every recipient" "recipients: '$recipients'" "$(docker logs --tail 10 "$AM" 2>&1)" \
       "$(docker logs --tail 10 "$MAIL" 2>&1)"
pass "the alert is emailed to every recipient, over STARTTLS with a login"
grep -q '"status":"firing"' <<<"$body" && grep -q "$ALERT" <<<"$body" \
  || fail "the alert is posted to the webhook" "body: ${body:0:300}"
pass "the alert is posted to the webhook"

echo
echo "PASS: all $PASSES alert delivery checks held."
