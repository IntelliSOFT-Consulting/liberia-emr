#!/usr/bin/env bash
# Refuses secrets, keys and PHI in the repository. Only .env.example templates are allowed.
#
#   scripts/validate/no-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail=0

# Real .env files must never be committed — only the .example templates.
while IFS= read -r f; do
  echo "FAIL: committed env file (only .env.example belongs in git): $f" >&2
  fail=1
done < <(cd "$ROOT" && git ls-files | grep -E '(^|/)[^/]*\.env$' || true)

# Private keys and certificates.
while IFS= read -r f; do
  echo "FAIL: key or certificate committed: $f" >&2
  fail=1
done < <(cd "$ROOT" && git ls-files | grep -E '\.(pem|key|p12|pfx|jks)$' || true)

# Assigned-looking credentials outside the templates.
while IFS= read -r hit; do
  echo "FAIL: possible hard-coded credential: $hit" >&2
  fail=1
done < <(cd "$ROOT" && git grep -nIE '(password|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9/+_-]{12,}' \
           -- ':!*.example' ':!scripts/validate/no-secrets.sh' ':!**/README.md' ':!docs/**' || true)

[[ $fail -eq 0 ]] && echo "no secrets detected" || exit 1
