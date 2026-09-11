#!/bin/sh
# Shared by both sync entrypoints: broker TLS and PGP payload encryption, read from the
# material mounted at /app/sync-certs (layout: scripts/security/gen-sync-certs.sh).
# Sourced, not executed. Every function fails loudly rather than starting weaker.

SYNC_CERTS=/app/sync-certs

sync_refuse() {
  echo "$SYNC_ROLE refusing to start; $*" >&2
  exit 2
}

sync_readable() {
  dir="$(dirname "$1")"
  [ -d "$dir" ] && [ -x "$dir" ] || sync_refuse "$dir is missing or cannot be entered by uid $(id -u)"
  [ -e "$1" ] || sync_refuse "missing $1"
  [ -r "$1" ] || sync_refuse "$1 is not readable by uid $(id -u)"
  [ -s "$1" ] || sync_refuse "$1 is empty"
}

# ARTEMIS_URL must be ssl://host:port and nothing else. The options that make the
# connection safe are appended here so no deployment can drop them: hostname
# verification against the broker certificate, and no advisory subscriptions (the broker
# does not serve them and a facility has no permission for them).
sync_broker_url() {
  case "$ARTEMIS_URL" in
    ssl://*\?*) sync_refuse "ARTEMIS_URL must be ssl://host:port without options, got '$ARTEMIS_URL'" ;;
    ssl://*:*)  ;;
    *)          sync_refuse "ARTEMIS_URL must be ssl://host:port (plain tcp is not accepted), got '$ARTEMIS_URL'" ;;
  esac
  ARTEMIS_URL="${ARTEMIS_URL}?socket.verifyHostName=true&jms.watchTopicAdvisories=false"
  export ARTEMIS_URL
}

sync_jvm_quote() {
  printf '"%s"\n' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# Writes the client keystore and truststore settings to a Java argument file, so the
# store passwords never appear in the process arguments or the environment. Sets
# SYNC_TLS_ARGS to "@<file>" for the java command line. Not called in a subshell, so a
# refusal exits the entrypoint itself.
sync_tls_argfile() {
  for f in client.p12 client.pass truststore.p12 truststore.pass; do
    sync_readable "$SYNC_CERTS/$f"
  done
  argfile=/app/config/jvm-tls.args
  (
    umask 077
    {
      sync_jvm_quote "-Djavax.net.ssl.keyStore=$SYNC_CERTS/client.p12"
      sync_jvm_quote "-Djavax.net.ssl.keyStoreType=PKCS12"
      sync_jvm_quote "-Djavax.net.ssl.keyStorePassword=$(cat "$SYNC_CERTS/client.pass")"
      sync_jvm_quote "-Djavax.net.ssl.trustStore=$SYNC_CERTS/truststore.p12"
      sync_jvm_quote "-Djavax.net.ssl.trustStoreType=PKCS12"
      sync_jvm_quote "-Djavax.net.ssl.trustStorePassword=$(cat "$SYNC_CERTS/truststore.pass")"
    } > "$argfile"
  )
  SYNC_TLS_ARGS="@$argfile"
}

# dbsync reads exactly one *-sec.asc and every *-pub.asc from the key folder. Checked
# here because dbsync only discovers a bad folder on the first message, long after start.
sync_pgp() {
  case "$SYNC_PAYLOAD_ENCRYPTION" in
    true)  ;;
    false) echo "WARNING: $SYNC_ROLE running with payload encryption OFF; the broker journal holds plaintext (sync-eip.md section 7.7)" >&2
           PGP_PASSWORD=""
           return 0 ;;
    *)     sync_refuse "SYNC_PAYLOAD_ENCRYPTION must be true or false, got '$SYNC_PAYLOAD_ENCRYPTION'" ;;
  esac
  [ -d "$SYNC_CERTS/pgp" ] && [ -x "$SYNC_CERTS/pgp" ] || sync_refuse "$SYNC_CERTS/pgp is missing or cannot be entered by uid $(id -u)"
  sec="$(find "$SYNC_CERTS/pgp" -maxdepth 1 -name '*-sec.asc' | wc -l | tr -d ' ')"
  pub="$(find "$SYNC_CERTS/pgp" -maxdepth 1 -name '*-pub.asc' | wc -l | tr -d ' ')"
  [ "$sec" = 1 ] || sync_refuse "$SYNC_CERTS/pgp must hold exactly one *-sec.asc, found $sec"
  [ "$pub" -ge 1 ] || sync_refuse "$SYNC_CERTS/pgp holds no *-pub.asc"
  sync_readable "$SYNC_CERTS/pgp.pass"
  # Deliberately not exported: the entrypoint passes it to envsubst alone, so it never
  # reaches the Java process environment.
  PGP_PASSWORD="$(cat "$SYNC_CERTS/pgp.pass")"
}
