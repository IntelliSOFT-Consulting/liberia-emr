#!/usr/bin/env bash
# Turns core's compiled jdbc_create_stored_procedures.sql into the script this module ships,
# and refuses to ship one that cannot run (ADR 0010 decisions 2 and 3).
#
#   finalize-jdbc-sql.sh <compiled jdbc_ file> <output file> <our _etl/sp_makefile>
#
# 1. Drops every statement that is only `SET GLOBAL ...`. Core's deploy script opens with
#    `SET GLOBAL event_scheduler = ON;`, which needs SUPER (ERROR 1227) and so aborts
#    setupEtl() for every non-SUPER user. The servers run with --event-scheduler=ON instead.
#    The script is split on `~-~-` lines by JdbcFlattenDatabaseDao; a statement is dropped
#    whole, comments included, because a comment-only statement is not empty to the DAO.
# 2. Fails if the result is missing or empty, or still contains `${var.` (a variable no
#    content layer declares), `SET GLOBAL`, or a `DELIMITER` directive (which JDBC cannot run),
#    or lacks a procedure our sp_makefile lists.
#
# Portable bash + awk + grep: it runs on the Linux build image and on a developer's macOS.
set -euo pipefail

src="${1:?compiled jdbc_ file}"
out="${2:?output file}"
makefile="${3:?_etl/sp_makefile}"

fail() { echo "finalize-jdbc-sql: FAIL: $*" >&2; exit 1; }

[[ -s "$src" ]] || fail "compiled script missing or empty: $src"
mkdir -p "$(dirname "$out")"

awk '
  function flush(   i, n, keep, has_global, other) {
    has_global = 0; other = 0
    for (i = 1; i <= nbuf; i++) {
      line = buf[i]
      sub(/^[ \t\r]+/, "", line)
      if (line == "" || line ~ /^--/) continue
      if (toupper(line) ~ /^SET[ \t]+GLOBAL[ \t]/) has_global = 1; else other = 1
    }
    # A statement that is nothing but SET GLOBAL is dropped with its separator. One that mixes
    # it with other SQL is kept, and the grep below fails the build on it: that is a core
    # change a human has to read.
    keep = !(has_global && !other)
    if (keep) {
      for (i = 1; i <= nbuf; i++) print buf[i]
      if (sep != "") print sep
    } else {
      dropped++
    }
    nbuf = 0; sep = ""
  }
  {
    t = $0; gsub(/^[ \t\r]+|[ \t\r]+$/, "", t)
    if (t == "~-~-") { sep = $0; flush(); next }
    buf[++nbuf] = $0
  }
  END {
    flush()
    printf "finalize-jdbc-sql: dropped %d SET GLOBAL statement(s)\n", dropped > "/dev/stderr"
  }
' "$src" > "$out"

[[ -s "$out" ]] || fail "finalized script is empty: $out"

if grep -n '\${var\.' "$out" >&2; then
  fail "unresolved \${var.*} tokens (declare them in a content layer's variables.properties)"
fi
if grep -n -i 'SET[[:space:]]\{1,\}GLOBAL' "$out" >&2; then
  fail "SET GLOBAL survives: it needs SUPER, which the ETL user does not have"
fi
if grep -n -i '^[[:space:]]*DELIMITER' "$out" >&2; then
  fail "DELIMITER directive survives: JDBC cannot execute it"
fi

# Every procedure our sp_makefile names must have been compiled in. compile-mysql.sh already
# refuses a missing file; this catches one it skipped for any other reason.
missing=0
while IFS= read -r entry; do
  name="$(basename "$entry" .sql)"
  if ! grep -q "CREATE PROCEDURE ${name}[[:space:](]" "$out"; then
    echo "finalize-jdbc-sql: no CREATE PROCEDURE ${name} in the compiled script" >&2
    missing=1
  fi
done < <(sed -E 's/#.*//; s/[[:space:]]+$//; /^[[:space:]]*$/d' "$makefile")
[[ $missing -eq 0 ]] || fail "procedures listed in $makefile are missing from the compiled script"

echo "finalize-jdbc-sql: wrote $out ($(wc -l < "$out" | tr -d ' ') lines)"
