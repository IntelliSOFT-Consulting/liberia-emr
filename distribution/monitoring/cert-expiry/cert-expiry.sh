#!/bin/sh
# Exposes the expiry of the sync broker's certificates and revocation list for Prometheus.
# Reads the broker's public/ directory only: certs/*.pem and crl.pem. It is mounted as a
# directory so a revocation list replaced with mv is seen.
#
#   cert-expiry.sh          serve :9101/metrics, refreshed every REFRESH_SECONDS
#   cert-expiry.sh --once   print the metrics once and exit
set -eu

PUBLIC="${PUBLIC_DIR:-/public}"
OUT_DIR=/tmp/www
REFRESH_SECONDS="${REFRESH_SECONDS:-3600}"

# "2027-09-14 20:51:38Z" (openssl -dateopt iso_8601) to epoch; empty on failure.
iso_to_epoch() {
  [ -n "$1" ] || return 0
  date -u -d "$(printf '%s' "$1" | sed 's/Z$//')" +%s 2>/dev/null || true
}

render() {
  found=0
  errors=0
  certs=""
  for pem in "$PUBLIC"/certs/*.pem; do
    [ -e "$pem" ] || continue
    identity="$(basename "$pem" .pem)"
    case "$identity" in
      ca) kind=ca ;; broker) kind=broker ;; sync-receiver) kind=receiver ;; broker-admin) kind=admin ;; *) kind=facility ;;
    esac
    not_after="$(iso_to_epoch "$(openssl x509 -in "$pem" -noout -enddate -dateopt iso_8601 2>/dev/null | cut -d= -f2)")"
    if [ -z "$not_after" ]; then
      errors=$((errors + 1))
      continue
    fi
    found=$((found + 1))
    certs="${certs}sync_cert_not_after_seconds{identity=\"$identity\",kind=\"$kind\"} $not_after
"
  done

  crl=""
  if [ -e "$PUBLIC/crl.pem" ]; then
    next="$(iso_to_epoch "$(openssl crl -in "$PUBLIC/crl.pem" -noout -nextupdate -dateopt iso_8601 2>/dev/null | cut -d= -f2)")"
    last="$(iso_to_epoch "$(openssl crl -in "$PUBLIC/crl.pem" -noout -lastupdate -dateopt iso_8601 2>/dev/null | cut -d= -f2)")"
    if [ -n "$next" ] && [ -n "$last" ]; then
      valid=0
      openssl crl -in "$PUBLIC/crl.pem" -CAfile "$PUBLIC/certs/ca.pem" -noout 2>/dev/null && valid=1
      crl="sync_crl_next_update_seconds $next
sync_crl_last_update_seconds $last
sync_crl_valid $valid
"
    else
      errors=$((errors + 1))
    fi
  fi

  echo "# TYPE sync_cert_not_after_seconds gauge"
  printf '%s' "$certs"
  echo "# TYPE sync_crl_next_update_seconds gauge"
  echo "# TYPE sync_crl_last_update_seconds gauge"
  echo "# TYPE sync_crl_valid gauge"
  printf '%s' "$crl"
  echo "# TYPE sync_cert_files_read gauge"
  echo "sync_cert_files_read $found"
  echo "# TYPE sync_cert_read_errors gauge"
  echo "sync_cert_read_errors $errors"
  echo "# TYPE sync_cert_expiry_last_run_seconds gauge"
  echo "sync_cert_expiry_last_run_seconds $(date -u +%s)"
}

if [ "${1:-}" = "--once" ]; then
  render
  exit 0
fi

mkdir -p "$OUT_DIR"
render > "$OUT_DIR/metrics.tmp" && mv "$OUT_DIR/metrics.tmp" "$OUT_DIR/metrics"
httpd -f -p 9101 -h "$OUT_DIR" &
httpd_pid=$!
trap 'kill "$httpd_pid" 2>/dev/null; exit 0' TERM INT
while sleep "$REFRESH_SECONDS" & wait $!; do
  render > "$OUT_DIR/metrics.tmp" && mv "$OUT_DIR/metrics.tmp" "$OUT_DIR/metrics"
done
