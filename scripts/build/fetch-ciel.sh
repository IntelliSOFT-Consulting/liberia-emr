#!/usr/bin/env bash
# Fetches the pinned CIEL dictionary export into content-common's ocl/ directory.
#
#   scripts/build/fetch-ciel.sh
#
# STATUS: not implemented — the CIEL export URL and subscription credentials come from the
# MOH's OCL account. See content-packages/content-common/configuration/backend_configuration/ocl/README.md.
#
# The version fetched MUST be pinned and recorded in the release notes: a floating CIEL
# version makes two builds of the same tag produce different metadata.
set -euo pipefail

echo "fetch-ciel.sh is not implemented." >&2
echo "Pin a CIEL export version and supply OCL credentials from the MOH secret store." >&2
exit 1
