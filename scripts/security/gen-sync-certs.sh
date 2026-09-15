#!/usr/bin/env bash
# Issues THROWAWAY sync security material for development, CI and staging drills: a CA
# with a revocation list, TLS keystores for the broker, the receiver, an admin and each
# facility, and the PGP key pairs dbsync uses to encrypt and sign payloads. It then
# enrols everything on the broker with render-broker-config.sh.
#
# Never use this output in production. There the MOH ICT Unit's PKI issues the
# certificates and owns the PGP keys (sync-eip.md sections 7.2 and 7.7); this script
# documents the exact shapes that process must produce.
#
#   scripts/security/gen-sync-certs.sh --out ~/.liberiaemr/sync-security \
#     [--broker-host central.example.org] [--facilities careysburg,barnersville] \
#     [--revoke <facility>] [--days 365]
#
# Layout, one directory per mount:
#   broker/            -> central artemis at /etc/broker-certs (public/ -> cert-expiry)
#   receiver/          -> central sync-receiver at /app/sync-certs
#   facility-<code>/   -> that facility's sync service at /app/sync-certs
#   admin/             client certificate for broker operators (the amq role)
#   ca/                the dev CA and its revocation database; mounted nowhere
#
# Re-running issues new keystores and PGP keys for everything except the CA. Certificates
# from earlier runs stay valid until they expire unless revoked; revocations persist.
# --revoke names a facility from --facilities: it is issued as usual, then revoked.
set -euo pipefail

OUT=""
BROKER_HOST="localhost"
FACILITIES="careysburg"
REVOKE=""
DAYS=365
PGP_DOMAIN="sync.liberiaemr"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)         OUT="$2"; shift 2 ;;
    --broker-host) BROKER_HOST="$2"; shift 2 ;;
    --facilities)  FACILITIES="$2"; shift 2 ;;
    --revoke)      REVOKE="$2"; shift 2 ;;
    --days)        DAYS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" ]] || { echo "--out <dir> is required" >&2; exit 2; }
for tool in openssl keytool gpg; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done

HERE="$(cd "$(dirname "$0")" && pwd)"
umask 077
mkdir -p "$OUT/ca"
OUT="$(cd "$OUT" && pwd)"
pw() { openssl rand -hex 16; }

# --- CA and its revocation database -------------------------------------------------
CA_DIR="$OUT/ca"
if [[ ! -f "$CA_DIR/ca.pem" ]]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days $((DAYS * 3)) -nodes \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.pem" \
    -subj "/C=LR/O=MOH LiberiaEMR DEV/CN=LiberiaEMR Sync Dev CA" 2>/dev/null
  echo "created dev CA"
fi
[[ -f "$CA_DIR/index.txt" ]] || : > "$CA_DIR/index.txt"
[[ -f "$CA_DIR/crlnumber" ]] || echo 1000 > "$CA_DIR/crlnumber"
cat > "$CA_DIR/openssl.cnf" <<EOF
[ ca ]
default_ca = dev
[ dev ]
database         = $CA_DIR/index.txt
crlnumber        = $CA_DIR/crlnumber
certificate      = $CA_DIR/ca.pem
private_key      = $CA_DIR/ca.key
default_md       = sha256
unique_subject   = no
default_crl_days = $DAYS
EOF

truststore() { # dir
  rm -f "$1/truststore.p12" "$1/truststore.pass"
  local p; p="$(pw)"
  keytool -importcert -noprompt -alias sync-ca -file "$CA_DIR/ca.pem" \
    -keystore "$1/truststore.p12" -storetype PKCS12 -storepass "$p" >/dev/null 2>&1
  printf %s "$p" > "$1/truststore.pass"
}

issue() { # dir name cn [san]
  local dir="$1" name="$2" cn="$3" san="${4:-}" p ext
  mkdir -p "$dir"
  rm -f "$dir/$name".*
  p="$(pw)"
  ext="$(mktemp)"
  if [[ -n "$san" ]]; then
    printf 'extendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san" > "$ext"
  else
    printf 'extendedKeyUsage=clientAuth\n' > "$ext"
  fi
  openssl req -newkey rsa:2048 -sha256 -nodes -keyout "$dir/$name.key" -out "$dir/$name.csr" \
    -subj "/C=LR/O=MOH LiberiaEMR/CN=$cn" 2>/dev/null
  openssl x509 -req -sha256 -days "$DAYS" -in "$dir/$name.csr" -CA "$CA_DIR/ca.pem" \
    -CAkey "$CA_DIR/ca.key" -set_serial "0x$(openssl rand -hex 8)" -extfile "$ext" \
    -out "$dir/$name.pem" 2>/dev/null
  openssl pkcs12 -export -inkey "$dir/$name.key" -in "$dir/$name.pem" -certfile "$CA_DIR/ca.pem" \
    -name "$name" -out "$dir/$name.p12" -passout "pass:$p"
  printf %s "$p" > "$dir/$name.pass"
  rm -f "$dir/$name.csr" "$dir/$name.key" "$ext"
  truststore "$dir"
}

# --- PGP (dbsync payload encryption and signing) ---------------------------------------
# dbsync loads exactly one "*-sec.asc" and every "*-pub.asc" from its key folder. Its
# PGP library finds a key by wrapping the configured id in <...> and matching it as a
# substring of the key's user id. Keys therefore carry the email form <code@domain>, and
# the apps are configured with the bare code@domain; the brackets on both sides stop
# one facility's id matching inside another's (careys vs careysburg).
pgp_uid() { printf '<%s@%s>' "$1" "$PGP_DOMAIN"; }

# Short path: gpg-agent sockets live in the homedir and unix socket paths are limited.
PGP_TMP="$(mktemp -d /tmp/lemr-pgp.XXXXXX)"
trap 'gpgconf --homedir "$PGP_TMP" --kill gpg-agent 2>/dev/null || true; rm -rf "$PGP_TMP"' EXIT

pgp_keypair() { # identity passphrase -> $PGP_TMP/<identity>-{sec,pub}.asc
  local id="$1" pass="$2" home="$PGP_TMP/home-$1" uid
  uid="$(pgp_uid "$id")"
  mkdir -p "$home"
  gpg --homedir "$home" --batch --pinentry-mode loopback --passphrase "$pass" \
    --quick-gen-key "$uid" rsa3072 sign never >/dev/null 2>&1
  local fpr
  fpr="$( gpg --homedir "$home" --batch --with-colons --list-keys "$uid" 2>/dev/null | awk -F: '/^fpr/ {print $10; exit}')"
  gpg --homedir "$home" --batch --pinentry-mode loopback --passphrase "$pass" \
    --quick-add-key "$fpr" rsa3072 encr never >/dev/null 2>&1
  gpg --homedir "$home" --batch --armor --export "$uid" > "$PGP_TMP/$id-pub.asc"
  gpg --homedir "$home" --batch --pinentry-mode loopback --passphrase "$pass" \
    --armor --export-secret-keys "$uid" > "$PGP_TMP/$id-sec.asc"
  gpgconf --homedir "$home" --kill gpg-agent 2>/dev/null || true
}

# --- Issue ---------------------------------------------------------------------------
echo "== broker (CN/SAN $BROKER_HOST, artemis) =="
issue "$OUT/broker" broker "$BROKER_HOST" "DNS:$BROKER_HOST,DNS:artemis,DNS:localhost"

echo "== receiver =="
issue "$OUT/receiver" client sync-receiver
RECEIVER_PGP_PASS="$(pw)"
pgp_keypair sync-receiver "$RECEIVER_PGP_PASS"

echo "== admin =="
issue "$OUT/admin" client broker-admin

render_args=()
for f in ${FACILITIES//,/ }; do
  echo "== facility $f =="
  issue "$OUT/facility-$f" client "$f"
  pass="$(pw)"
  pgp_keypair "$f" "$pass"
  rm -rf "$OUT/facility-$f/pgp"
  mkdir -p "$OUT/facility-$f/pgp"
  cp "$PGP_TMP/$f-sec.asc" "$PGP_TMP/sync-receiver-pub.asc" "$OUT/facility-$f/pgp/"
  printf %s "$pass" > "$OUT/facility-$f/pgp.pass"
  render_args+=(--facility "$f=$OUT/facility-$f/client.pem")
done

rm -rf "$OUT/receiver/pgp"
mkdir -p "$OUT/receiver/pgp"
cp "$PGP_TMP/sync-receiver-sec.asc" "$OUT/receiver/pgp/"
for f in ${FACILITIES//,/ }; do cp "$PGP_TMP/$f-pub.asc" "$OUT/receiver/pgp/"; done
printf %s "$RECEIVER_PGP_PASS" > "$OUT/receiver/pgp.pass"

# --- Revocation list -----------------------------------------------------------------
if [[ -n "$REVOKE" ]]; then
  [[ ",$FACILITIES," == *",$REVOKE,"* ]] || { echo "--revoke '$REVOKE' must also be listed in --facilities" >&2; exit 2; }
  openssl ca -config "$CA_DIR/openssl.cnf" -revoke "$OUT/facility-$REVOKE/client.pem"
  echo "revoked facility $REVOKE"
fi
mkdir -p "$OUT/broker/public"
openssl ca -config "$CA_DIR/openssl.cnf" -gencrl -out "$OUT/broker/public/crl.pem" 2>/dev/null
chmod 644 "$OUT/broker/public/crl.pem"

# --- Enrol on the broker ---------------------------------------------------------------
"$HERE/render-broker-config.sh" --out "$OUT/broker" --ca "$CA_DIR/ca.pem" --broker-cert "$OUT/broker/broker.pem" \
  --receiver "$OUT/receiver/client.pem" --admin "$OUT/admin/client.pem" "${render_args[@]}"

echo
echo "Done: $OUT. Every .pass file holds the password of the store beside it."
echo "On Linux, give each mount to its container user: broker/ to uid 1001, receiver/ and facility-*/ to uid 999."
echo "DEVELOPMENT MATERIAL ONLY; production certificates and PGP keys come from the MOH ICT Unit."
