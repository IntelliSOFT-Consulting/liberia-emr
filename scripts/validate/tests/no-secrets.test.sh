#!/usr/bin/env bash
# Tests for scripts/validate/no-secrets.sh (LE-340).
#
#   scripts/validate/tests/no-secrets.test.sh
#
# Each case writes a fixture into a throwaway git repository and runs the scanner against it
# (NO_SECRETS_ROOT). Fixtures are generated here rather than committed, because a committed
# fixture holding a fake password would itself trip the scanner on this repository. The fake
# values are deliberately short and symbol-bearing: that is the shape the old check missed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCANNER="$HERE/../no-secrets.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
passed=0 failed=0

# scan <expected: fail|pass> <name> <path> <content>
scan() {
  local want="$1" name="$2" path="$3" content="$4" repo out rc
  repo="$work/$name"
  mkdir -p "$repo/$(dirname "$path")"
  printf '%s\n' "$content" > "$repo/$path"
  git -C "$repo" init -q
  git -C "$repo" add -A
  set +e
  out="$(NO_SECRETS_ROOT="$repo" "$SCANNER" 2>&1)"
  rc=$?
  set -e
  local got=pass
  [[ $rc -ne 0 ]] && got=fail
  if [[ "$got" != "$want" ]]; then
    echo "FAIL [$name]: expected $want, got $got"
    printf '%s\n' "$out" | sed 's/^/    /'
    failed=$((failed + 1))
    return
  fi
  # A failure must name the file and key, never echo the value it caught.
  if [[ "$want" == "fail" ]] && printf '%s' "$out" | grep -qE 'abc&(amp;)?123xyz|abc123xyz''LONGVALUE9'; then
    echo "FAIL [$name]: the scanner printed the secret value"
    failed=$((failed + 1))
    return
  fi
  echo "ok   [$name]: $want"
  passed=$((passed + 1))
}

# --- must fail: a literal credential in a config file, whatever its length ---------------
scan fail env-short-symbols      deploy/site.env.example   'LIBERIAEMR_MFL_PASSWORD=abc&123xyz'
scan fail properties             app/runtime.properties    'connection.password=abc&123xyz'
scan fail yaml-quoted            compose.yml               'DB_PASSWORD: "abc&123xyz"'
scan fail yaml-bare              ci.yaml                   'api_key: abc&123xyz'
scan fail json                   config.json               '{"secretToken": "abc&123xyz"}'
scan fail xml-element            settings.xml              '<password>abc&amp;123xyz</password>'
scan fail second-on-a-line       workflow.yml              'run: docker run -e DB_USER=u -e DB_PASSWORD=abc&123xyz img'
scan fail allowlisted-key-other-value compose.yml          'MYSQL_PASSWORD: abc&123xyz'
# Review of #192: a literal hidden in a reference's default, an expression, or a passphrase.
scan fail env-default-literal    compose.yml               'DB_PASSWORD: ${DB_PASSWORD:-abc&123xyz}'
scan fail gh-expression-literal  workflow.yml              "API_TOKEN: \${{ 'abc&123xyz' }}"
scan fail quoted-passphrase      site.env.example          'DB_PASSWORD="correct horse battery abc&123xyz"'
scan fail json-next-line         config.json               $'{\n  "password":\n    "abc&123xyz"\n}'
scan fail xml-multiline          settings.xml              $'<password>\n  abc&amp;123xyz\n</password>'
scan fail yaml-run-block         workflow.yml              $'steps:\n  - run: |\n      docker run -e DB_PASSWORD=abc&123xyz img'
# The legacy long-token rule must name the file and line only, never print the match.
# Split in two, so this file does not itself hold a 12-character token for the scanner to find.
scan fail legacy-long-token      notes/setup.sh            'token=abc123xyz''LONGVALUE9'

# --- must pass: references, placeholders, settings, throwaways and prose -----------------
scan pass placeholder-change-me  site.env.example          'MYSQL_PASSWORD=CHANGE_ME'
scan pass placeholder-angle      vars.yml                  'db_password: <add_the_password>'
scan pass empty                  site.env.example          'SMTP_PASSWORD='
scan pass env-reference          compose.yml               'MARIADB_PASSWORD: ${MYSQL_PASSWORD}'
scan pass env-default            compose.yml               'ETL_DB_PASSWORD: ${ETL_DB_PASSWORD:-}'
scan pass env-required           compose.yml               'MGMT_DB_PASSWORD: ${SYNC_MGMT_DB_PASSWORD:?set in central.env}'
scan pass yaml-prose-block       playbook.yaml             $'- fail:\n    msg: >\n      Also set SYNC_REST_PASSWORD: the compose file requires it.'
scan pass help-message-key       config.json               '{"passwordHelpMessage": "Use at least thirteen characters"}'
scan pass github-expression      workflow.yml              'NODE_AUTH_TOKEN: ${{ secrets.NPM_AUTH_TOKEN }}'
scan pass setting-boolean        config.json               '{"showPasswordReset": true}'
scan pass setting-number         vars.properties           'security.password.minimum-length=13'
scan pass password-file-path     compose.yml               'LIBERIAEMR_MFL_PASSWORD_FILE: /run/secrets/mfl-password'
scan pass privilege-uuid         vars.properties           'var.privilege.view-token-registrations.uuid=efb8d8d5-5540-4055-b065-04085cab6398'
scan pass allowlisted-throwaway  workflow.yml              'MYSQL_PASSWORD=ci-ephemeral'
scan pass ui-translation         app/translations/en.json  '{"newPassword": "New password"}'
scan pass comment                site.env.example          '# LIBERIAEMR_MFL_PASSWORD=abc&123xyz is how it looks'
scan pass source-code-not-config App.java                  'String password = "abc&123xyz";'

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
