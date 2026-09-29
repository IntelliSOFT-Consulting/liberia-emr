#!/usr/bin/env bash
# Refuses secrets, keys and PHI in the repository. Only .env.example templates are allowed.
#
#   scripts/validate/no-secrets.sh
#
# NO_SECRETS_ROOT points it at another git checkout; the tests in
# scripts/validate/tests/no-secrets.test.sh use that to scan throwaway fixtures.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${NO_SECRETS_ROOT:-$(cd "$HERE/../.." && pwd)}"
ALLOWLIST="${NO_SECRETS_ALLOWLIST:-$HERE/no-secrets.allowlist}"
fail=0

# Real .env files must never be committed — only the .example templates.
while IFS= read -r f; do
  echo "FAIL: committed env file (only .env.example belongs in git): $f" >&2
  fail=1
done < <(cd "$ROOT" && git ls-files | grep -E '(^|/)[^/]*\.env$' || true)

# Private keys, certificates, keystore passwords and PGP secret keys.
while IFS= read -r f; do
  echo "FAIL: key or certificate committed: $f" >&2
  fail=1
done < <(cd "$ROOT" && git ls-files | grep -E '\.(pem|key|p12|pfx|jks|pass)$|-sec\.asc$' || true)

# Assigned-looking credentials outside the templates: a long token-shaped value, in any file.
while IFS= read -r hit; do
  echo "FAIL: possible hard-coded credential: $hit" >&2
  fail=1
done < <(cd "$ROOT" && git grep -nIE '(password|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9/+_-]{12,}' \
           -- ':!*.example' ':!scripts/validate/no-secrets.sh' ':!**/README.md' ':!docs/**' || true)

# Any value, whatever its length or characters, assigned to a credential-named key in a config
# file (LE-340). The check above misses a short or symbol-bearing password such as
# "il1k&n2x", which is what real service passwords look like. Source code is out of scope:
# a Java variable named password is not a credential. See no-secrets.allowlist for the known
# throwaways, and the allowed() rules below for what counts as a reference, not a value.
command -v python3 >/dev/null || { echo "FAIL: python3 is required by $0" >&2; exit 1; }
# The program goes in with -c, so stdin stays free for the file list. read -d '' rather than
# $(cat <<...): bash 3.2 (macOS) can mis-parse quotes and parentheses in a heredoc inside $( ).
read -r -d '' config_check <<'PY' || true
import os, re, sys

root, allowlist_path = sys.argv[1], sys.argv[2]
files = [f for f in sys.stdin.read().split('\0') if f]

CONFIG = re.compile(r'(^|/)(\.env[^/]*|[^/]*\.env(\.[^/]*)?|[^/]*\.(properties|ya?ml|xml|json))$')
SKIP = re.compile(r'(^|/)(translations|node_modules)/|(^|/)package-lock\.json$')  # UI strings, vendored
KEY = r'[A-Za-z0-9_.\-]*(?:password|passwd|secret|token|api[_-]?key)[A-Za-z0-9_.\-]*'
# The separator must not be followed by = (a comparison) or by - ? + (shell parameter
# expansion: the key inside ${SOME_PASSWORD:-} is a reference, not an assignment).
ASSIGN = re.compile(r'(?i)(?:^|(?<=[\s,{"\']))["\']?(?P<k>' + KEY + r')["\']?\s*(?P<sep>[:=])(?![=\-?+])')
XML_ELEMENT = re.compile(r'(?i)<(?P<k>' + KEY + r')(?:\s[^>]*)?>(?P<v>[^<]*)</')
# A key that names something about a credential rather than the credential itself.
NOT_A_CREDENTIAL = re.compile(
    r'(?i)([._\-](file|path|dir|url|uri|length|days|count|enabled|expiry|name|user|username|type'
    r'|policy|mode|uuid|reset|header|prefix|suffix|pattern|regex|label|id|endpoint)'
    r'|file|path|url|screen|reset|required|policy|length)$')

allow = set()
for line in open(allowlist_path, encoding='utf-8'):
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    entry, _, reason = line.partition(' #')
    if not reason.strip():
        print(f"FAIL: allowlist entry without a reason: {entry}", file=sys.stderr)
        sys.exit(1)
    allow.add(entry.strip())

def value_of(sep, raw):
    """The assigned value: a quoted string, else one shell word after '=', else the YAML rest."""
    raw = raw.strip()
    q = re.match(r'(["\'])(.*?)\1', raw)
    if q:
        return q.group(2).strip()
    if sep == '=':
        return raw.split()[0].rstrip(');') if raw else ''   # a shell word; drop a closing ) or ;
    return re.sub(r'\s+#.*$', '', raw).strip().rstrip(',').strip()

def allowed(k, v):
    if not v or v.startswith('='):                                  # empty, or a comparison (==)
        return True
    if re.fullmatch(r'\$\{\{.*\}\}', v):                            # GitHub expression
        return True
    if re.match(r'\$\{|\$[A-Za-z_]', v):                            # environment reference
        return True
    if re.fullmatch(r'(?i)change_?me|<[^>]*>|x+|\*+|\.\.\.|todo', v):  # placeholder
        return True
    if re.fullmatch(r'(?i)true|false|null|none|yes|no|\d{1,4}', v):  # a setting, not a secret
        return True
    if NOT_A_CREDENTIAL.search(k):
        return True
    if len(v.split()) >= 3:                                         # prose, e.g. a UI message
        return True
    return f"{k}={v}" in allow

fail = False
for f in files:
    if not CONFIG.search(f) or SKIP.search(f):
        continue
    try:
        lines = open(os.path.join(root, f), encoding='utf-8').read().split('\n')
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        continue
    for n, line in enumerate(lines, 1):
        s = line.strip()
        if s.startswith(('#', '//', '<!--', '*')):                  # comments
            continue
        # Match key and separator only, then read each value from after its own match, so a
        # line such as `-e A_PASSWORD=x -e B_PASSWORD=y` has both of its values checked.
        found = [(m.group('k'), value_of(m.group('sep'), line[m.end():])) for m in ASSIGN.finditer(line)]
        found += [(m.group('k'), m.group('v').strip()) for m in XML_ELEMENT.finditer(line)]
        for k, v in found:
            if not allowed(k, v):
                # Never print the value itself: the log would leak what the check just caught.
                print(f"FAIL: credential assigned in a config file: {f}:{n}: {k} "
                      f"(a literal value; load it from the environment, or allowlist a throwaway)",
                      file=sys.stderr)
                fail = True
sys.exit(1 if fail else 0)
PY
if ! (cd "$ROOT" && git ls-files -z) | python3 -c "$config_check" "$ROOT" "$ALLOWLIST"; then
  fail=1
fi

[[ $fail -eq 0 ]] && echo "no secrets detected" || exit 1
