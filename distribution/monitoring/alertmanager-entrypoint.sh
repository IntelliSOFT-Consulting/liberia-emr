#!/bin/sh
# Renders Alertmanager's configuration from the environment and starts it. Every alert
# goes to each channel that is configured:
#
#   ALERT_WEBHOOK_URL       a webhook (Slack, Teams, an SMS gateway and OpenHIM all take one)
#   ALERT_EMAIL_TO          comma-separated addresses, sent through an SMTP relay with
#   ALERT_EMAIL_FROM          ALERT_SMTP_SMARTHOST (host:port), optionally authenticated with
#   ALERT_SMTP_SMARTHOST      ALERT_SMTP_USER and ALERT_SMTP_PASSWORD. STARTTLS is required
#                             unless ALERT_SMTP_REQUIRE_TLS=false.
#
# With no channel, alerts are only visible in the Prometheus and Alertmanager UIs, which is
# acceptable on a development box and nowhere else. The webhook URL and SMTP password are
# written to files Alertmanager reads, so neither is ever parsed as YAML; the other values
# are checked before they are quoted into it.
set -euf

refuse() {
  echo "alertmanager refusing to start; $*" >&2
  exit 2
}

NEWLINE='
'

# One line with no whitespace, quotes or backslashes, so the value is safe inside double quotes.
plain() {
  case "$1" in *"$NEWLINE"*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^[^[:space:]"\\]+$'
}

email() {
  case "$1" in *"$NEWLINE"*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$'
}

umask 077
CONF=/tmp/alertmanager.yml
channels=""

if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  printf '%s' "$ALERT_WEBHOOK_URL" > /tmp/webhook-url
  channels="$channels
    webhook_configs:
      - url_file: /tmp/webhook-url
        send_resolved: true"
fi

if [ -n "${ALERT_EMAIL_TO:-}" ]; then
  [ -n "${ALERT_EMAIL_FROM:-}" ] || refuse "ALERT_EMAIL_TO is set but ALERT_EMAIL_FROM is not"
  [ -n "${ALERT_SMTP_SMARTHOST:-}" ] || refuse "ALERT_EMAIL_TO is set but ALERT_SMTP_SMARTHOST is not"
  plain "$ALERT_SMTP_SMARTHOST" && printf '%s' "$ALERT_SMTP_SMARTHOST" | grep -Eq '^[A-Za-z0-9.-]+:[0-9]+$' \
    || refuse "ALERT_SMTP_SMARTHOST must be host:port, got '$ALERT_SMTP_SMARTHOST'"
  case "$ALERT_EMAIL_TO" in *"$NEWLINE"*) refuse "ALERT_EMAIL_TO must be one line" ;; esac
  for address in $(printf '%s' "$ALERT_EMAIL_TO" | tr ',' ' ') "$ALERT_EMAIL_FROM"; do
    email "$address" || refuse "'$address' is not an email address; separate addresses with commas"
  done
  case "${ALERT_SMTP_REQUIRE_TLS:=true}" in
    true|false) ;;
    *) refuse "ALERT_SMTP_REQUIRE_TLS must be true or false, got '$ALERT_SMTP_REQUIRE_TLS'" ;;
  esac

  auth=""
  if [ -n "${ALERT_SMTP_USER:-}" ]; then
    plain "$ALERT_SMTP_USER" || refuse "ALERT_SMTP_USER must not contain spaces, quotes or backslashes"
    [ -n "${ALERT_SMTP_PASSWORD:-}" ] || refuse "ALERT_SMTP_USER is set but ALERT_SMTP_PASSWORD is not"
    printf '%s' "$ALERT_SMTP_PASSWORD" > /tmp/smtp-password
    auth="
        auth_username: \"$ALERT_SMTP_USER\"
        auth_password_file: /tmp/smtp-password"
  fi

  channels="$channels
    email_configs:
      - to: \"$(printf '%s' "$ALERT_EMAIL_TO" | tr -d ' ')\"
        from: \"$ALERT_EMAIL_FROM\"
        smarthost: \"$ALERT_SMTP_SMARTHOST\"
        require_tls: $ALERT_SMTP_REQUIRE_TLS$auth
        send_resolved: true"
fi

if [ -z "$channels" ]; then
  echo "WARNING: neither ALERT_WEBHOOK_URL nor ALERT_EMAIL_TO is set; alerts are delivered nowhere" >&2
fi

cat > "$CONF" <<EOF
route:
  receiver: admins
  group_by: [alertname]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: admins$channels
EOF

/bin/amtool check-config "$CONF" >&2 || refuse "the rendered configuration is invalid"
exec /bin/alertmanager --config.file="$CONF" --storage.path=/alertmanager "$@"
