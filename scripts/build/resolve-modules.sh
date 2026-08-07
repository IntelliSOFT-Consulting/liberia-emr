#!/usr/bin/env bash
# Downloads the OMODs pinned in distro.properties into the backend build context.
#
#   scripts/build/resolve-modules.sh --out distribution/backend/modules
#
# Resolution is delegated to the OpenMRS SDK's build-distro goal, which already turns a
# distro.properties into a module set — including the groupId and type overrides
# (omod.<id>.groupId, omod.<id>.type) that a hand-rolled resolver would have to reinvent.
#
# The SDK is fed a distro.properties reduced to the platform and OMOD entries. The frontend
# is deliberately excluded: scripts/build/generate-import-map.sh owns the SPA, and letting
# build-distro assemble it here would download the whole ESM set a second time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DISTRO="$ROOT/distribution/distro.properties"
# Pinned like everything else: a floating SDK version can resolve the same distro.properties
# differently between two builds of one tag.
SDK_VERSION="${OPENMRS_SDK_VERSION:-6.8.0}"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" ]] || { echo "--out <dir> is required" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# build-distro refuses to run outside a Maven project, but reads the module set from the
# file named by -Ddistro rather than from this POM.
#
# The repositories are not optional here. This POM is synthetic and has no parent, so it
# inherits nothing from content-packages/pom.xml, and Maven Central carries none of
# org.openmrs — the SDK plugin itself, the platform WAR and every OMOD come from
# mavenrepo.openmrs.org. Without them the goal fails on the WAR before it reaches a single
# module:
#
#   Could not find artifact org.openmrs.web:openmrs-webapp:war:2.8.8 in central
#
# and a developer whose ~/.m2 already holds those artifacts, or whose settings.xml declares
# the repository, will not reproduce it — it only shows up on a clean machine such as a CI
# runner. Keep in step with the declarations in content-packages/pom.xml.
cat > "$work/pom.xml" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0">
	<modelVersion>4.0.0</modelVersion>
	<groupId>lr.gov.moh.liberiaemr</groupId>
	<artifactId>liberiaemr-module-resolver</artifactId>
	<version>1</version>
	<packaging>pom</packaging>

	<repositories>
		<repository>
			<id>openmrs-repo</id>
			<name>OpenMRS Public Repository</name>
			<url>https://mavenrepo.openmrs.org/public</url>
			<!--
				Snapshots are ENABLED here and disabled everywhere else, for exactly one
				reason: distribution/distro.properties pins omod.spa=3.1.0-SNAPSHOT, which
				upstream RefApp does too and which that file already flags as VERIFY. There is
				no released spa-omod 3.1.0 to move to — 3.0.0 is the newest release — so until
				one exists the module set cannot be resolved without this. Turn it back off in
				the same change that pins omod.spa to a release.
			-->
			<snapshots>
				<enabled>true</enabled>
			</snapshots>
		</repository>
	</repositories>

	<pluginRepositories>
		<pluginRepository>
			<id>openmrs-releases</id>
			<name>OpenMRS Public</name>
			<url>https://mavenrepo.openmrs.org/public</url>
			<snapshots>
				<enabled>false</enabled>
			</snapshots>
		</pluginRepository>
	</pluginRepositories>
</project>
POM

grep -E '^(name|version|war\.|omod\.)' "$DISTRO" > "$work/openmrs-distro.properties"

# omod.<id>.groupId and omod.<id>.type qualify a module, they do not declare another one.
expected="$(grep -E '^omod\.[^=]+=' "$work/openmrs-distro.properties" \
  | grep -vcE '^omod\.[^=]+\.(groupId|type|artifactId)=')"

echo "resolving $expected OMODs with openmrs-sdk $SDK_VERSION"
mvn -B -q -f "$work/pom.xml" \
  "org.openmrs.maven.plugins:openmrs-sdk-maven-plugin:${SDK_VERSION}:build-distro" \
  -Ddistro="$work/openmrs-distro.properties" \
  -Ddir="$work/distro" \
  -Dreset=true -DbatchAnswers=y

mkdir -p "$OUT"
rm -f "$OUT"/*.omod
# The SDK writes to web/openmrs_modules/ for a backend-only distro and web/modules/ when a
# frontend is present; search rather than depend on which.
find "$work/distro" -name '*.omod' -exec cp {} "$OUT/" \;

# The SDK reports a missing artifact as a warning and carries on, so a silently short module
# set would otherwise reach the image and only surface as a failed startup.
got="$(find "$OUT" -name '*.omod' | wc -l | tr -d ' ')"
if [[ "$got" -ne "$expected" ]]; then
  echo "FAIL: distro.properties pins $expected OMODs but $got resolved" >&2
  exit 1
fi

echo "resolved $got OMODs into ${OUT#$ROOT/}"
