#!/bin/sh
# Starts the broker against the material mounted at /etc/broker-certs, and restarts it when
# the revocation list changes, because Artemis reads crlPath only at start.
set -eu

CERTS=/etc/broker-certs
INSTANCE=/opt/liberiaemr-broker
ETC="$INSTANCE/etc"
CRL="$CERTS/public/crl.pem"

refuse() { echo "broker refusing to start; $*" >&2; exit 2; }

for d in "$CERTS" "$CERTS/public"; do
  [ -d "$d" ] && [ -x "$d" ] || refuse "$d is missing or cannot be entered by uid $(id -u)"
done
for f in broker.p12 broker.pass truststore.p12 truststore.pass public/crl.pem public/certs/ca.pem \
         cert-users.properties cert-roles.properties admin-cert-users.properties admin-cert-roles.properties \
         sync-security.xml sync-addresses.xml sync-diverts.xml; do
  [ -e "$CERTS/$f" ] || refuse "missing $CERTS/$f"
  [ -r "$CERTS/$f" ] || refuse "$CERTS/$f is not readable by uid $(id -u)"
  [ -s "$CERTS/$f" ] || refuse "$CERTS/$f is empty"
done

# A revocation list that does not verify against the CA, or has lapsed, makes Java refuse
# every client, so it is never loaded.
crl_ok() {
  openssl crl -in "$1" -CAfile "$CERTS/public/certs/ca.pem" -noout 2>/dev/null || return 1
  next="$(openssl crl -in "$1" -noout -nextupdate 2>/dev/null | cut -d= -f2)"
  [ -n "$next" ] && [ "$(date -u -d "$next" +%s)" -gt "$(date -u +%s)" ]
}
crl_ok "$CRL" || refuse "$CRL does not verify against public/certs/ca.pem or has lapsed"

# The passwords land inside an XML attribute and an acceptor URI, where & ; and quotes break.
KS_PASS="$(cat "$CERTS/broker.pass")"
TS_PASS="$(cat "$CERTS/truststore.pass")"
for p in "$KS_PASS" "$TS_PASS"; do
  printf '%s' "$p" | grep -Eq '^[A-Za-z0-9._~-]+$' \
    || refuse "keystore passwords may use only letters, digits and . _ ~ -"
done

umask 077
rm -f "$ETC/broker.xml"
sed "s|__KEYSTORE_PASSWORD__|$KS_PASS|g; s|__TRUSTSTORE_PASSWORD__|$TS_PASS|g" \
  "$ETC/broker.xml.tmpl" > "$ETC/broker.xml"

# JAAS resolves its file names against etc; the XIncludes use absolute paths instead.
for f in cert-users.properties cert-roles.properties admin-cert-users.properties admin-cert-roles.properties; do
  ln -sf "$CERTS/$f" "$ETC/$f"
done

crl_sum() { sha256sum "$CRL" 2>/dev/null | cut -d' ' -f1; }
loaded="$(crl_sum)"

"$INSTANCE/bin/artemis" run &
broker=$!
trap 'kill -TERM "$broker" 2>/dev/null; wait "$broker"; exit $?' TERM INT

warned=""
while kill -0 "$broker" 2>/dev/null; do
  sleep 5 & wait $!
  current="$(crl_sum)"
  if [ "$current" = "$loaded" ]; then
    warned=""
  elif [ -z "$current" ] || ! crl_ok "$CRL"; then
    [ "$warned" = "x$current" ] || echo "WARNING: replacement $CRL is unreadable, does not verify against the CA, or has lapsed; keeping the loaded list" >&2
    warned="x$current"
  else
    echo "revocation list changed; restarting the broker to load it" >&2
    kill -TERM "$broker"
    wait "$broker" || true
    # Non-zero so both restart: unless-stopped and restart: on-failure bring it back.
    exit 75
  fi
done
wait "$broker"
