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
# Report only file:line, never the matched text: that would print the secret into the CI log.
while IFS= read -r hit; do
  echo "FAIL: possible hard-coded credential: $(printf '%s' "$hit" | cut -d: -f1,2)" >&2
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
# Searched over the whole file, so an element split across lines is still read.
XML_ELEMENT = re.compile(r'(?i)<(?P<k>' + KEY + r')(?:\s[^>]*)?>(?P<v>[^<]*)</', re.S)
# A key that names something about a credential rather than the credential itself, including
# the text shown around one (a help message, a label).
NOT_A_CREDENTIAL = re.compile(
    r'(?i)([._\-](file|path|dir|url|uri|length|days|count|enabled|expiry|name|user|username|type'
    r'|policy|mode|uuid|reset|header|prefix|suffix|pattern|regex|label|id|endpoint'
    r'|message|msg|help|hint|description|text|title|prompt|error|placeholder)'
    r'|file|path|url|screen|reset|required|policy|length|message|help|hint|description)$')
# Only these count as references: an environment variable with no default or an empty one,
# and a GitHub expression naming a context value. A default or expression that carries a
# literal (${X:-hunter2}, ${{ 'hunter2' }}) is itself a hard-coded credential.
# ${X:?message} is also a reference: its text is the error shown when X is unset, not a value.
ENV_REFERENCE = re.compile(
    r'\$\{[A-Za-z_][A-Za-z0-9_]*(:?[-?])?\}|\$\{[A-Za-z_][A-Za-z0-9_]*:?\?[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*')
BLOCK_SCALAR = re.compile(r':\s*[>|][-+0-9]*\s*(#.*)?$')          # YAML `key: >` / `key: |`
GH_EXPRESSION = re.compile(r'\$\{\{\s*(secrets|env|vars|inputs|steps|needs|github|matrix)\.[A-Za-z0-9_.\-]+\s*\}\}')

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
    if GH_EXPRESSION.fullmatch(v) or ENV_REFERENCE.fullmatch(v):    # references, not values
        return True
    if re.fullmatch(r'(?i)change_?me|<[^>]*>|x+|\*+|\.\.\.|todo', v):  # placeholder
        return True
    if re.fullmatch(r'(?i)true|false|null|none|yes|no|\d{1,4}', v):  # a setting, not a secret
        return True
    if NOT_A_CREDENTIAL.search(k):
        return True
    return f"{k}={v}" in allow

fail = False
for f in files:
    if not CONFIG.search(f) or SKIP.search(f):
        continue
    try:
        text = open(os.path.join(root, f), encoding='utf-8').read()
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        continue
    lines = text.split('\n')
    found = []                                                      # (line number, key, value)
    is_yaml = f.endswith(('.yml', '.yaml'))
    block_indent = None           # indentation of the key that opened a YAML block scalar
    for n, line in enumerate(lines, 1):
        s = line.strip()
        indent = len(line) - len(line.lstrip())
        if block_indent is not None:
            # Text inside a folded or literal block (msg: >, run: |) is prose or a script body.
            # Scripts are still read, since `run: |` holds env assignments; prose under other
            # keys is not.
            if not s or indent > block_indent:
                if not block_is_script:
                    continue
            else:
                block_indent = None
        if is_yaml and BLOCK_SCALAR.search(line):
            block_indent = indent
            block_is_script = bool(re.match(r'\s*-?\s*(run|script|command|entrypoint)\s*:', line))
        if s.startswith(('#', '//', '<!--', '*')):                  # comments
            continue
        # Match key and separator only, then read each value from after its own match, so a
        # line such as `-e A_PASSWORD=x -e B_PASSWORD=y` has both of its values checked.
        for m in ASSIGN.finditer(line):
            rest = line[m.end():]
            if not rest.strip() and m.group('sep') == ':' and f.endswith('.json'):
                # JSON may put the value on the next line: "password":\n  "hunter2"
                nxt = next((l for l in lines[n:] if l.strip()), '')
                rest = nxt if nxt.strip().startswith(('"', "'")) else rest
            found.append((n, m.group('k'), value_of(m.group('sep'), rest)))
    for m in XML_ELEMENT.finditer(text):
        found.append((text.count('\n', 0, m.start()) + 1, m.group('k'), m.group('v').strip()))
    for n, k, v in found:
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
