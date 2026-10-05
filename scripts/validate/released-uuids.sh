#!/usr/bin/env bash
# Refuses a change to content that a release already shipped (LE-399, IMPLEMENTATION.md §9).
#
#   scripts/validate/released-uuids.sh [--base <git ref>] [--allowlist <file>]
#
# A database that loaded a release holds its UUIDs for good. Changing one in content does not
# change that database: Initializer cannot load the new UUID under a name the old row still
# holds, and continue_on_error keeps that out of sight, while records synced from a facility
# that did load it reach central as placeholders (LE-373). Both dev servers hit exactly this in
# August, with two partograph concepts. So, against the newest liberiaemr-* release tag (or
# --base), this fails when:
#
#   * a UUID that a released variables.properties declared (as a var.*) is no longer declared by
#     any var.*. Moving it to another key is allowed and reported: the UUID, and every row and
#     record built on it, is unchanged (LE-343 did exactly that);
#   * a UUID that a released CSV defined in its Uuid column (literally, or through a var.*) is
#     no longer defined by any CSV. Retiring a row through Void/Retire keeps it; deleting the
#     row or giving it another UUID does not.
#
# content-demo (training data, never in a release) is out of scope, and so are var.form.* keys:
# a form's UUID is derived from its name and version (validate-content.sh, "AMPATH form UUID
# consistency"), so a version bump is a new form beside the old one, which is how forms change. A deliberate exception goes
# in released-uuids.allowlist with its reason, and needs a second reviewer: the databases that
# loaded the old value must be repaired by hand (docs/runbooks/sync-operations.md §17).
#
# With no release tag yet it does nothing. RELEASED_UUIDS_ROOT points it at another repository,
# for its tests.
set -euo pipefail

ROOT="${RELEASED_UUIDS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BASE=""
ALLOWLIST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/released-uuids.allowlist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)      BASE="$2"; shift 2 ;;
    --allowlist) ALLOWLIST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$BASE" ]]; then
  BASE="$(git -C "$ROOT" tag --list 'liberiaemr-*' --sort=-v:refname | head -n1)"
  if [[ -z "$BASE" ]]; then
    echo "released UUIDs: no liberiaemr-* release tag, so nothing has shipped yet; nothing to check"
    exit 0
  fi
fi
git -C "$ROOT" rev-parse -q --verify "$BASE^{commit}" >/dev/null \
  || { echo "FAIL: $BASE is not a commit in $ROOT (a shallow clone without tags?)" >&2; exit 1; }
[[ -f "$ALLOWLIST" ]] || ALLOWLIST=/dev/null

python3 - "$ROOT" "$BASE" "$ALLOWLIST" <<'PY'
import csv, io, re, subprocess, sys

root, base, allowlist_path = sys.argv[1:4]
UUID = re.compile(r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d+A+)$")
VAR = re.compile(r"^\$\{(var\.[^}]+)\}$")
CONTENT = re.compile(r"^content-packages/(?!content-demo/)[^/]+/configuration/")

def git(*args):
    return subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True).stdout

def files_at(ref):
    out = git("ls-tree", "-r", "--name-only", ref, "content-packages") if ref else \
          git("ls-files", "--cached", "--others", "--exclude-standard", "content-packages")
    return [f for f in out.splitlines() if CONTENT.match(f) and "/target/" not in f]

def read(ref, path):
    if ref:
        return git("show", f"{ref}:{path}")
    with open(f"{root}/{path}", encoding="utf-8") as f:
        return f.read()

def snapshot(ref):
    """var key -> {value: [package, ...]}, and uuid -> [where it is defined]"""
    files = files_at(ref)
    variables = {}
    for f in files:
        if not f.endswith("/variables.properties"):
            continue
        pkg = f.split("/")[1]
        for line in read(ref, f).splitlines():
            s = line.strip()
            if not s or s.startswith(("#", "!")) or "=" not in s:
                continue
            k, v = (p.strip() for p in s.split("=", 1))
            # var.form.*: derived from name and version, so a version bump is a new form (see header).
            if k.startswith("var.") and not k.startswith("var.form.") and UUID.match(v):
                variables.setdefault(k, {}).setdefault(v, []).append(pkg)
    resolve = {k: next(iter(vals)) for k, vals in variables.items() if len(vals) == 1}
    defined = {}
    for f in files:
        if not f.endswith(".csv") or "/backend_configuration/" not in f:
            continue
        lines = [l for l in read(ref, f).splitlines() if not l.lstrip().startswith("#")]
        rows = list(csv.reader(io.StringIO("\n".join(lines))))
        if not rows:
            continue
        header = [h.strip().lower() for h in rows[0]]
        if "uuid" not in header:
            continue
        col = header.index("uuid")
        for n, row in enumerate(rows[1:], 2):
            if col >= len(row):
                continue
            cell = row[col].strip()
            m = VAR.match(cell)
            uuid = resolve.get(m.group(1)) if m else (cell if UUID.match(cell) else None)
            if uuid:
                defined.setdefault(uuid.lower(), []).append((f, m.group(1) if m else None))
    return variables, defined

allow = set()
for line in open(allowlist_path, encoding="utf-8"):
    s = line.strip()
    if not s or s.startswith("#"):
        continue
    entry, _, reason = s.partition(" #")
    if not reason.strip():
        sys.exit(f"FAIL: released-uuids.allowlist entry without a reason: {entry.strip()}")
    allow.add(entry.strip().lower())

def allowed(*entries):
    """An entry names a var key, a key=uuid pair, or a bare uuid; compared case-insensitively."""
    return any(e and e.lower() in allow for e in entries)

old_vars, old_defined = snapshot(base)
new_vars, new_defined = snapshot(None)

problems, moved = [], []
declared_now = {}
for key, values in new_vars.items():
    for value in values:
        declared_now.setdefault(value, []).append(key)
for key, values in sorted(old_vars.items()):
    for value, pkgs in values.items():
        if value in new_vars.get(key, {}):
            continue
        if value in declared_now:
            moved.append(f"{key} -> {', '.join(sorted(declared_now[value]))} ({value})")
            continue
        if allowed(key, f"{key}={value}", value):
            continue
        problems.append(f"{key} = {value} (in {', '.join(pkgs)} in {base}) is no longer declared by any var.*")
for uuid, where in sorted(old_defined.items()):
    # An allowlisted variable covers the rows defined through it.
    if uuid in new_defined or allowed(uuid) or any(allowed(key, f"{key}={uuid}") for _, key in where if key):
        continue
    f, key = where[0]
    problems.append(f"{uuid}, defined by {f} ({key or 'literal'}) in {base}, is no longer defined by any CSV")

checked = sum(len(v) for v in old_vars.values())
for m in moved:
    print(f"released UUIDs: moved to another key, UUID unchanged: {m}")
if problems:
    print(f"FAIL: content changes {len(problems)} UUID(s) that {base} already shipped:", file=sys.stderr)
    for p in problems:
        print("  " + p, file=sys.stderr)
    print(file=sys.stderr)
    print("  Shipped content is append-only (IMPLEMENTATION.md section 9): a database that loaded the old", file=sys.stderr)
    print("  value keeps it, and Initializer will not load the new one beside it. Restore the old value;", file=sys.stderr)
    print("  retire a row with Void/Retire instead of deleting it; add new metadata under a new key.", file=sys.stderr)
    print("  A deliberate exception goes in scripts/validate/released-uuids.allowlist with its reason and", file=sys.stderr)
    print("  needs a second reviewer, because every database that loaded it must be repaired by hand.", file=sys.stderr)
    sys.exit(1)
print(f"released UUIDs: {checked} variables and {len(old_defined)} CSV rows that {base} shipped are unchanged")
PY
