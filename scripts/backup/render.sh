#!/usr/bin/env bash
# Renders the *.tpl files into runnable scripts by replacing {{UPPER_CASE}}
# placeholders with values from an env file.
#
# Usage: ./render.sh <env-file> [output-dir]      (output-dir defaults to ./rendered)
#
# Env file format: one KEY=VALUE per line; blank lines and # comments are ignored.
# Most keys are required. A few have defaults (see DEFAULTS below) and can be
# left out of the env file entirely if you don't need them.
#
# Safety rules:
#   - only {{UPPER_CASE_NAMES}} are placeholders; other double-brace text, such as
#     Docker's '{{.State.Running}}', is left untouched
#   - every placeholder must have a value (either set explicitly, or from
#     DEFAULTS below), or nothing is written
#   - values may not contain quotes, $, backticks, backslashes, ; & | < > ( ) %
#     or newlines, because they end up inside shell scripts and a crontab
#   - values may not be empty or the REPLACE_ME sample text (an explicit empty
#     default in DEFAULTS is fine — that's not the same as a user writing
#     KEY= with nothing after it)

set -euo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:?Usage: $0 <env-file> [output-dir]}"
OUT_DIR="${2:-${HERE}/rendered}"

# Keys here are optional in the env file. If the user doesn't set one, this
# value is used instead. Add to this list as new optional settings appear —
# everything else stays strictly required, so a genuine typo or missing value
# still fails loudly instead of silently deploying a broken config.
declare -A DEFAULTS=(
  [REMOTE_UPLOAD]="false"
  [UPLOAD_METHOD]="rclone"
  [RCLONE_REMOTE]=""
  [SCP_DESTINATION]=""
  [EXTRA_STOP_CONTAINERS]=""
)

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: env file not found: ${ENV_FILE}"
  exit 1
fi

shopt -s nullglob
templates=("${HERE}"/*-template.sh)
if [ "${#templates[@]}" -eq 0 ]; then
  echo "ERROR: no *-template.sh files found next to render.sh"
  exit 1
fi

# ---- Parse the env file --------------------------------------------------
declare -A VALUES=()
lineno=0
while IFS= read -r line || [ -n "${line}" ]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"                                   # tolerate CRLF files
  if [[ "${line}" =~ ^[[:space:]]*(#|$) ]]; then continue; fi
  if [[ ! "${line}" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    echo "ERROR: ${ENV_FILE} line ${lineno} is not KEY=VALUE (keys are UPPER_CASE)"
    exit 1
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  # strip one pair of surrounding quotes
  if [[ "${value}" =~ ^\"(.*)\"$ || "${value}" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi

  if [ -z "${value}" ]; then
    echo "ERROR: ${key} has an empty value"; exit 1
  fi
  if [[ "${value}" == *REPLACE_ME* ]]; then
    echo "ERROR: ${key} still has the REPLACE_ME sample value"; exit 1
  fi
  if [[ "${value}" == *[\"\'\$\`\\\;\&\|\<\>\(\)%]* ]]; then
    echo "ERROR: ${key} contains a character that is not allowed in values (quotes \$ \` \\ ; & | < > ( ) %)"
    exit 1
  fi
  VALUES["${key}"]="${value}"
done < "${ENV_FILE}"

# Fill in defaults for any optional key the user didn't set. Only kicks in
# when the key is absent entirely — if the user wrote KEY= with nothing after
# it, that already failed the empty-value check above, on purpose: leaving a
# key out means "use the default", writing it blank is treated as a mistake.
for key in "${!DEFAULTS[@]}"; do
  if [ -z "${VALUES[${key}]+set}" ]; then
    VALUES["${key}"]="${DEFAULTS[${key}]}"
  fi
done

# ---- Render every template into a temp dir first --------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
used=" "
problems=0

for tpl in "${templates[@]}"; do
  name="$(basename "${tpl}" | sed "s/-template\.sh$/.sh/")"
  content="$(cat "${tpl}"; printf x)"; content="${content%x}"   # keep trailing newline

  for key in "${!VALUES[@]}"; do
    ph="{{${key}}}"
    if [[ "${content}" == *"${ph}"* ]]; then
      used+="${key} "
      content="${content//"${ph}"/"${VALUES[${key}]}"}"
    fi
  done

  left="$(printf '%s' "${content}" | grep -oE '\{\{[A-Z][A-Z0-9_]*\}\}' | sort -u | tr '\n' ' ' || true)"
  if [ -n "${left}" ]; then
    echo "ERROR: ${name}: no value provided for: ${left}"
    problems=1
    continue
  fi
  printf '%s' "${content}" > "${tmp}/${name}"
  case "${name}" in *.sh) chmod 750 "${tmp}/${name}" ;; *) chmod 640 "${tmp}/${name}" ;; esac
done

if [ "${problems}" -ne 0 ]; then
  echo "Nothing was written. Add the missing keys to ${ENV_FILE} and rerun."
  exit 1
fi

for key in "${!VALUES[@]}"; do
  if [[ "${used}" != *" ${key} "* ]]; then echo "WARNING: ${key} is set but not used by any template"; fi
done

mkdir -p "${OUT_DIR}"
cp -p "${tmp}"/* "${OUT_DIR}/"
echo "Rendered into ${OUT_DIR}:"
ls -1 "${tmp}" | sed 's/^/  /'