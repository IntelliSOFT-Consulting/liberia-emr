#!/usr/bin/env bash
# Renders the sync broker's enrolment into the directory mounted at /etc/broker-certs:
# which certificate is which identity, what each identity may do, and the per-facility
# addresses. Certificates come from the MOH ICT Unit's PKI in production and from
# gen-sync-certs.sh in development. Re-run with the full facility list, then restart.
#
#   scripts/security/render-broker-config.sh --out <broker-dir> --ca ca.pem \
#     --broker-cert broker.pem --receiver receiver.pem --admin admin.pem \
#     --facility careysburg=careysburg.pem [--facility ...]
set -euo pipefail

OUT=""
CA=""
BROKER_CERT=""
RECEIVER=""
ADMIN=""
FACILITIES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)         OUT="$2"; shift 2 ;;
    --ca)          CA="$2"; shift 2 ;;
    --broker-cert) BROKER_CERT="$2"; shift 2 ;;
    --receiver)    RECEIVER="$2"; shift 2 ;;
    --admin)       ADMIN="$2"; shift 2 ;;
    --facility)    FACILITIES+=("$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" && -n "$CA" && -n "$BROKER_CERT" && -n "$RECEIVER" && -n "$ADMIN" && ${#FACILITIES[@]} -gt 0 ]] \
  || { echo "--out, --ca, --broker-cert, --receiver, --admin and at least one --facility are required" >&2; exit 2; }

# The receiver's durable subscription as the dbsync receiver opens it (clientId and
# subscription name in distribution/sync/receiver-application.properties.template).
RECEIVER_SUBSCRIPTION="DB-SYNC-REC.DB-SYNC-RECEIVER"

# Artemis matches the subject as Java renders it: CN=careysburg, O=MOH LiberiaEMR, C=LR
subject_of() {
  local pem="$1" s
  [[ -f "$pem" ]] || { echo "certificate not found: $pem" >&2; exit 1; }
  s="$(openssl x509 -in "$pem" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
  [[ "$s" != *\\* ]] || { echo "subject of $pem contains escaped characters; enrol it by hand: $s" >&2; exit 1; }
  printf '%s' "${s//,/, }"
}

SEEN_SUBJECTS=""
SEEN_CODES=""
LINE=""
# Sets LINE to "identity=subject". A subject enrolled twice would make Artemis pick one
# identity arbitrarily, so it is refused.
add_identity() {
  local subject
  subject="$(subject_of "$2")"
  if grep -Fxq "$subject" <<<"$SEEN_SUBJECTS"; then
    echo "subject '$subject' of $2 is already enrolled under another identity" >&2
    exit 1
  fi
  SEEN_SUBJECTS+="$subject"$'\n'
  LINE="$1=$subject"
}

# Public material (certificates and the revocation list) lives in public/, the only
# directory the expiry exporter mounts.
PUB="$OUT/public/certs"
mkdir -p "$PUB"
rm -f "$PUB"/*.pem
cp "$CA" "$PUB/ca.pem"
cp "$BROKER_CERT" "$PUB/broker.pem"

add_identity sync-receiver "$RECEIVER"
users="$LINE"
roles="receiver=sync-receiver"
cp "$RECEIVER" "$PUB/sync-receiver.pem"

add_identity broker-admin "$ADMIN"
admin_users="$LINE"
cp "$ADMIN" "$PUB/broker-admin.pem"

addresses=""
diverts=""
security=""
for entry in "${FACILITIES[@]}"; do
  code="${entry%%=*}"
  pem="${entry#*=}"
  [[ "$code" =~ ^[a-z0-9][a-z0-9-]{1,31}$ ]] \
    || { echo "facility code '$code' must be lowercase letters, digits and hyphens" >&2; exit 1; }
  case "$code" in
    sync-receiver|broker-admin|broker|ca) echo "facility code '$code' is reserved" >&2; exit 1 ;;
  esac
  case " $SEEN_CODES " in
    *" $code "*) echo "facility code '$code' is listed twice" >&2; exit 1 ;;
  esac
  SEEN_CODES+=" $code"

  add_identity "$code" "$pem"
  users+=$'\n'"$LINE"
  roles+=$'\n'"facility-$code=$code"
  cp "$pem" "$PUB/$code.pem"

  addresses+="
  <address name=\"sync.facility.$code\">
    <multicast/>
  </address>"
  diverts+="
  <divert name=\"sync-facility-$code\">
    <address>sync.facility.$code</address>
    <forwarding-address>openmrs.sync.topic</forwarding-address>
    <exclusive>true</exclusive>
  </divert>"
  security+="
  <security-setting match=\"sync.facility.$code\">
    <permission type=\"send\" roles=\"facility-$code\"/>
  </security-setting>"
done

printf '%s\n' "$users" > "$OUT/cert-users.properties"
printf '%s\n' "$roles" > "$OUT/cert-roles.properties"
printf '%s\n' "$admin_users" > "$OUT/admin-cert-users.properties"
printf '%s\n' "amq=broker-admin" > "$OUT/admin-cert-roles.properties"

# The receiver's subscription queue is declared here rather than created on its first
# connection, so messages are kept from the broker's first start (risk E11).
cat > "$OUT/sync-addresses.xml" <<EOF
<addresses xmlns="urn:activemq:core">
  <address name="openmrs.sync.topic">
    <multicast>
      <queue name="$RECEIVER_SUBSCRIPTION"/>
    </multicast>
  </address>
  <address name="DLA">
    <anycast>
      <queue name="DLQ"/>
    </anycast>
  </address>$addresses
</addresses>
EOF

cat > "$OUT/sync-diverts.xml" <<EOF
<diverts xmlns="urn:activemq:core">$diverts
</diverts>
EOF

# Facilities: send to their own address, nothing else. Receiver: consume its subscription.
# Operators (amq, admin acceptor only): everything, including the dead-letter queue.
cat > "$OUT/sync-security.xml" <<EOF
<security-settings xmlns="urn:activemq:core">
  <security-setting match="openmrs.sync.topic">
    <permission type="consume" roles="receiver"/>
    <permission type="browse" roles="receiver,amq"/>
  </security-setting>$security
  <security-setting match="#">
    <permission type="send" roles="amq"/>
    <permission type="consume" roles="amq"/>
    <permission type="browse" roles="amq"/>
    <permission type="manage" roles="amq"/>
    <permission type="createAddress" roles="amq"/>
    <permission type="deleteAddress" roles="amq"/>
    <permission type="createDurableQueue" roles="amq"/>
    <permission type="deleteDurableQueue" roles="amq"/>
    <permission type="createNonDurableQueue" roles="amq"/>
    <permission type="deleteNonDurableQueue" roles="amq"/>
  </security-setting>
</security-settings>
EOF

chmod 755 "$OUT/public" "$PUB"
chmod 644 "$PUB"/*.pem

echo "enrolled ${#FACILITIES[@]} facilities into $OUT"
