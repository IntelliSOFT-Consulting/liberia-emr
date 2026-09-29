#!/usr/bin/env bash
# Makes sure a sync service's OpenMRS account exists with its one role and signs in, for
# .github/workflows/enable-dev-sync.yml. Passwords come from the environment, never arguments.
#
#   OPENMRS_ADMIN_PASSWORD=... SERVICE_PASSWORD=... dev-sync-user.sh <base-url> <username> "<role>"
set -euo pipefail

BASE="$1/openmrs/ws/rest/v1"
USERNAME="$2"
ROLE="$3"
ADMIN="${OPENMRS_ADMIN_USER:-admin}"
: "${OPENMRS_ADMIN_PASSWORD:?}" "${SERVICE_PASSWORD:?}"

api() { curl -sk -u "$ADMIN:$OPENMRS_ADMIN_PASSWORD" -H 'Content-Type: application/json' "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d, 'arg': sys.argv[2:]}))" "$@"; }

[ "$(api "$BASE/session" | json 'd.get("authenticated")')" = True ] \
  || { echo "the admin password does not sign in at $1" >&2; exit 1; }
role="$(api "$BASE/role?v=custom:(uuid,display)&limit=100" | json "next((r['uuid'] for r in d['results'] if r['display'] == arg[0]), '')" "$ROLE")"
[ -n "$role" ] || { echo "no role '$ROLE' at $1; the national content package defines it" >&2; exit 1; }

case "$USERNAME" in admin|daemon) echo "refusing to repurpose the $USERNAME account for sync" >&2; exit 1 ;; esac
users="$(api "$BASE/user?q=$USERNAME&v=custom:(uuid,username,roles:(display))")"
existing="$(json "next((u['uuid'] for u in d['results'] if u['username'] == arg[0]), '')" "$USERNAME" <<<"$users")"
others="$(json "','.join(r['display'] for u in d['results'] if u['username'] == arg[0] for r in u['roles'] if r['display'] != arg[1])" "$USERNAME" "$ROLE" <<<"$users")"
# An account that already does something else is someone's; it is never changed here.
[ -z "$others" ] || { echo "$USERNAME already holds other roles ($others); use an account of its own for sync" >&2; exit 1; }
body="$(ROLE_UUID="$role" python3 -c 'import json,os; print(json.dumps({"password": os.environ["SERVICE_PASSWORD"], "roles": [os.environ["ROLE_UUID"]]}))')"
if [ -z "$existing" ]; then
  body="$(USERNAME="$USERNAME" BODY="$body" python3 -c 'import json,os; b=json.loads(os.environ["BODY"]); b["username"]=os.environ["USERNAME"]; b["person"]={"names":[{"givenName":"Sync","familyName":"Service"}],"gender":"U"}; print(json.dumps(b))')"
  result="$(api "$BASE/user" -X POST -d "$body")"
  action=created
else
  result="$(api "$BASE/user/$existing" -X POST -d "$body")"
  action=updated
fi
[ -n "$(json 'd.get("uuid", "")' <<<"$result")" ] \
  || { echo "could not save $USERNAME: $(json 'd.get("error", {}).get("message", d)' <<<"$result")" >&2; exit 1; }

[ "$(curl -sk -u "$USERNAME:$SERVICE_PASSWORD" "$BASE/session" | json 'd.get("authenticated")')" = True ] \
  || { echo "$USERNAME was $action but cannot sign in" >&2; exit 1; }
echo "$USERNAME $action with the $ROLE role, and signs in at $1"
