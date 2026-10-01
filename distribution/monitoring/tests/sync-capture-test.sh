#!/bin/sh
# Unit test for sync-capture/sync-capture.sh: a fake database client and offset file stand in
# for the facility, and each step checks what the exporter reports.
#
#   distribution/monitoring/tests/sync-capture-test.sh [path/to/sync-capture.sh]
set -eu

EXPORTER="${1:-$(dirname "$0")/../sync-capture/sync-capture.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# The fake client prints whatever the test last wrote to ids, or fails when it is absent.
cat > "$WORK/bin/mariadb" <<EOF
#!/bin/sh
[ -f "$WORK/ids" ] && cat "$WORK/ids"
EOF
chmod +x "$WORK/bin/mariadb"

offset() { # file pos ts
  printf '\254\355\000\005sr\000\021java.util.HashMapxp{"transaction_id":null,"ts_sec":%s,"file":"%s","pos":%s,"server_id":1001}x' \
    "$3" "$1" "$2" > "$WORK/offsets.txt"
}
run() {
  PATH="$WORK/bin:$PATH" OFFSETS_FILE="$WORK/offsets.txt" STATE_FILE="$WORK/state" sh "$EXPORTER" --once
}
metric() { run | sed -n "s/^$1 //p"; }
age_waiting() { # seconds: pretend the rows were first seen that long ago
  sed -i.bak "s/^waiting_since=.*/waiting_since=$(( $(date -u +%s) - $1 ))/" "$WORK/state"
}
check() { # description expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$3'" >&2; exit 1; fi
}

offset binlog.000016 145933 1790228551
echo "10,20,30,40,50,60,70,80,90" > "$WORK/ids"
check "a first run sees nothing waiting" 0 "$(metric sync_capture_stalled_seconds)"
check "it reads the saved position" 1 "$(metric sync_capture_offset_readable)"
check "it reports the time of the last event saved" 1790228551 "$(metric sync_capture_last_event_seconds)"
check "a quiet facility is not stalled" 0 "$(metric sync_capture_stalled_seconds)"

echo "11,20,30,41,55,60,70,80,90" > "$WORK/ids"
check "new rows start the clock at zero" 0 "$(metric sync_capture_stalled_seconds)"
age_waiting 1000
stalled="$(metric sync_capture_stalled_seconds)"
[ "$stalled" -ge 1000 ] && [ "$stalled" -lt 1010 ] || { echo "FAIL rows waiting with an unmoved position count up: $stalled" >&2; exit 1; }
echo "ok   rows waiting with an unmoved position count up ($stalled s)"

offset binlog.000016 151200 1790229100
check "the position moving clears the stall" 0 "$(metric sync_capture_stalled_seconds)"
check "and stays clear while nothing new arrives" 0 "$(metric sync_capture_stalled_seconds)"

rm "$WORK/ids"
check "an unreachable database is reported" 0 "$(metric sync_capture_db_readable)"
check "and is never read as a stall" 0 "$(metric sync_capture_stalled_seconds)"

echo "12,20,30,41,55,60,70,80,90" > "$WORK/ids"
rm "$WORK/offsets.txt"
run > /dev/null
check "a missing position is reported" 0 "$(metric sync_capture_offset_readable)"
echo "13,20,30,41,55,60,70,80,90" > "$WORK/ids"
age_waiting 1000
check "rows with no position to judge them by are never a stall" 0 "$(metric sync_capture_stalled_seconds)"
unverified="$(metric sync_capture_unverified_seconds)"
[ "$unverified" -ge 1000 ] || { echo "FAIL they are reported as unverified instead: $unverified" >&2; exit 1; }
echo "ok   they are reported as unverified instead"

printf '\254\355\000\005sr\000\021java.util.HashMapxp{"ts_sec":1790229200,"file":"binlog.000016","pos":151200,"snapshot":true,"snapshot_completed":false}x' > "$WORK/offsets.txt"
run > /dev/null
echo "14,20,30,41,55,60,70,80,90" > "$WORK/ids"
run > /dev/null
age_waiting 5000
check "a first load in progress is reported" 1 "$(metric sync_capture_snapshot)"
check "and never counts as a stall, however long it holds one position" 0 "$(metric sync_capture_stalled_seconds)"

echo "PASS: sync-capture exporter"
