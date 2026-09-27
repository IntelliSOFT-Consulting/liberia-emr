#!/usr/bin/env bash
# Throwaway material for the MFL stub and the backend that syncs from it, for a disposable test
# stack only.
#
#   qa/api/mfl-stub/gen-material.sh <dir> [--cacerts /path/to/jdk/cacerts]
#
# Writes into <dir>:
#   ca.pem, ca.key            a CA that exists only for this stack
#   stub.pem, stub.key        the stub's certificate: mfl-stub, mfl-stub-elsewhere, localhost,
#                             127.0.0.1
#   truststore.p12            the JDK's own cacerts plus that CA (password: changeit), mounted
#                             into the backend so it trusts the stub over real TLS
#   username, password        the stub account; the password is random for every run and
#                             contains '&', like the real one, so the leak checks look for a
#                             value that the secret scan would not catch
#
# Nothing here is a real credential, and nothing here is committed: <dir> should be a temp
# directory (CI uses $RUNNER_TEMP). On macOS, Docker Desktop does not share /tmp, so pick a
# directory under your home or the repository for a local run.
set -euo pipefail

DIR="${1:?usage: gen-material.sh <dir> [--cacerts path]}"
shift
CACERTS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cacerts) CACERTS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$CACERTS" ]]; then
  for candidate in "${JAVA_HOME:-}/lib/security/cacerts" "${JAVA_HOME:-}/jre/lib/security/cacerts"; do
    [[ -f "$candidate" ]] && { CACERTS="$candidate"; break; }
  done
fi
[[ -f "$CACERTS" ]] || { echo "FAIL: no JDK cacerts found; set JAVA_HOME or pass --cacerts" >&2; exit 1; }
command -v keytool >/dev/null || { echo "FAIL: keytool is not on PATH" >&2; exit 1; }

mkdir -p "$DIR"
cd "$DIR"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=LiberiaEMR QA MFL stub CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.pem >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj "/CN=mfl-stub" -keyout stub.key -out stub.csr >/dev/null 2>&1
cat > stub.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:mfl-stub,DNS:mfl-stub-elsewhere,DNS:localhost,IP:127.0.0.1
EXT
openssl x509 -req -in stub.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
  -extfile stub.ext -out stub.pem >/dev/null 2>&1
rm -f stub.csr stub.ext ca.srl

rm -f truststore.p12
keytool -importkeystore -noprompt -srckeystore "$CACERTS" -srcstorepass changeit \
  -destkeystore truststore.p12 -deststoretype PKCS12 -deststorepass changeit >/dev/null 2>&1
keytool -importcert -noprompt -alias liberiaemr-qa-mfl-stub -file ca.pem \
  -keystore truststore.p12 -storetype PKCS12 -storepass changeit >/dev/null

printf '%s\n' "qa-mfl-stub" > username
# 12 random characters plus '&': never a real value, regenerated every run.
printf 'qa%s&stub\n' "$(openssl rand -hex 6)" > password
# The stub runs as a non-root user in its container and the backend reads the password file
# as the tomcat user, so these must be world-readable. They are throwaway.
chmod 0644 ca.pem stub.pem stub.key truststore.p12 username password
chmod 0600 ca.key

echo "MFL stub material written to $DIR"
