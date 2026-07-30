#!/usr/bin/env bash
# scaffold.sh — LiberiaEMR implementation scaffold.
#
# Follows the canonical OpenMRS O3 two-artefact model:
#   1) a DISTRIBUTION tree (pins platform + module + content versions -> Docker images)
#   2) one or more CONTENT PACKAGES (versioned config + clinical content,
#      consumed by the Initializer backend + O3 runtime JSON)
#
# Content packages are LAYERED: common -> programme -> site, so shared metadata is
# reused while facility-specific differences stay isolated.
#
# Idempotent: safe to re-run. Creates directories, .gitkeep placeholders, and the
# per-package Maven boilerplate (pom.xml / assembly.xml / content.properties /
# variables.properties). It NEVER overwrites a file that already exists, so hand-written
# metadata is safe.
#
# Usage: ./scaffold.sh [ROOT]   (default: the repository root, i.e. ".")
set -euo pipefail

ROOT="${1:-.}"

GROUP_ID="lr.gov.moh.liberiaemr.content"
PKG_VERSION="1.0.0-SNAPSHOT"

# Standard Initializer backend_configuration domains (subset relevant to this project).
BACKEND_DOMAINS=(
  concepts
  ocl
  locations
  locationtags
  encountertypes
  visittypes
  patientidentifiertypes
  programs
  programworkflows
  privileges
  roles
  globalproperties
  ampathforms
  drugs
  orderfrequencies
  liquibase
)

# dir-name : maven-artifactId : human description
CONTENT_PACKAGES=(
  "content-common:liberiaemr-common:Shared CIEL concepts, core encounter/visit types, generic forms and shared frontend config"
  "content-liberia-mch:liberiaemr-mch:ANC / Labour and Delivery / PNC / Family Planning — first go-live priority"
  "content-liberia-lab:liberiaemr-lab:Laboratory (HIS-Lite) order types, result concepts and lab configuration"
  "content-liberia-pharmacy:liberiaemr-pharmacy:Pharmacy/dispensing and stock (HIS-Lite), formulary"
  "content-liberia-opd-ipd:liberiaemr-opd-ipd:OPD / IPD encounter and admission workflows"
  "content-liberia-national:liberiaemr-national:MOH national identifiers, forms, RBAC baseline and reporting mappings"
  "content-site-careysburg:liberiaemr-site-careysburg:Careysburg Health Center facility configuration"
  "content-site-barnersville:liberiaemr-site-barnersville:Barnersville Health Center facility configuration"
  "content-demo:liberiaemr-demo:Training and test data — NEVER shipped to production"
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# write_if_absent <path> ; body on stdin
write_if_absent() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  if [[ -e "$path" ]]; then
    cat >/dev/null   # drain stdin
    return 0
  fi
  cat >"$path"
}

gen_pom() {
  local base="$1" artifact="$2" description="$3"
  write_if_absent "$base/pom.xml" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
	<modelVersion>4.0.0</modelVersion>
	<parent>
		<groupId>${GROUP_ID}</groupId>
		<artifactId>liberiaemr-content-packages</artifactId>
		<version>${PKG_VERSION}</version>
		<relativePath>../pom.xml</relativePath>
	</parent>
	<artifactId>${artifact}</artifactId>
	<packaging>pom</packaging>
	<name>LiberiaEMR :: ${artifact}</name>
	<description>${description}</description>
</project>
POM
}

gen_assembly() {
  local base="$1"
  write_if_absent "$base/assembly.xml" <<'ASSEMBLY'
<assembly xmlns="http://maven.apache.org/plugins/maven-assembly-plugin/assembly/1.1.3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/plugins/maven-assembly-plugin/assembly/1.1.3
                              http://maven.apache.org/xsd/assembly-1.1.3.xsd">
	<id>assemble-content</id>
	<formats>
		<format>zip</format>
	</formats>
	<includeBaseDirectory>false</includeBaseDirectory>
	<fileSets>
		<fileSet>
			<directory>${project.build.directory}</directory>
			<includes>
				<include>content.properties</include>
			</includes>
			<outputDirectory>/</outputDirectory>
		</fileSet>
		<fileSet>
			<directory>${project.basedir}/configuration</directory>
			<includes>
				<include>**/*</include>
			</includes>
		</fileSet>
	</fileSets>
</assembly>
ASSEMBLY
}

gen_content_properties() {
  local base="$1" description="$2"
  write_if_absent "$base/content.properties" <<PROPS
# content.properties — ${description}
#
# DECLARE RANGES HERE, NEVER EXACT PINS. A content package says "I need this or later";
# only distribution/distro.properties pins an exact tested version. See IMPLEMENTATION.md §6.

name=\${project.artifactId}
version=\${project.version}

# --- Platform ---
war.openmrs = >=2.7.0

# --- Backend modules (OMOD) ---
omod.initializer = >=2.9.0
omod.webservices.rest = >=2.47.0

# --- Frontend modules (ESM) ---
# spa.frontendModules.@openmrs/esm-patient-chart-app = >=9.0.0

# --- Other content packages this one layers on top of ---
# content.liberiaemr-common = >=1.0.0
PROPS
}

gen_variables() {
  local base="$1" artifact="$2"
  write_if_absent "$base/configuration/variables.properties" <<VARS
# variables.properties — ${artifact}
#
# Declare every UUID ONCE here, then reference it as \${var.<name>} in Initializer CSV/JSON,
# forms, reports and frontend configuration. Never hard-code a UUID anywhere else.
# A downstream site package may override any variable to map onto pre-existing metadata.
# See IMPLEMENTATION.md §7.
VARS
}

mk_content_pkg() {
  local base="$1" artifact="$2" description="$3"
  mkdir -p "$base"
  for d in "${BACKEND_DOMAINS[@]}"; do
    mkdir -p "$base/configuration/backend_configuration/$d"
  done
  mkdir -p "$base/configuration/frontend_configuration"
  gen_pom "$base" "$artifact" "$description"
  gen_assembly "$base"
  gen_content_properties "$base" "$description"
  gen_variables "$base" "$artifact"
}

# ---------------------------------------------------------------------------
# tree
# ---------------------------------------------------------------------------

dirs=(
  "distribution"
  "distribution/gateway"
  "distribution/backend"
  "distribution/frontend"
  "distribution/compose/facility"
  "distribution/compose/central"
  "distribution/env"
  "distribution/ci"
  ".github/workflows"
  "docs/architecture"
  "docs/adr"
  "docs/dak"
  "docs/security"
  "docs/runbooks"
  "docs/metadata-specs"
  "scripts/validate"
  "scripts/build"
  "scripts/deploy"
  "qa/api"
  "qa/e2e"
  "qa/manual"
  "qa/uat"
  "qa/upgrade"
  "integration/eip/routes"
  "integration/dhis2/mappings"
  "integration/cross-facility"
  "integration/msupply"
  "integration/fhir"
  "packages/esm-liberia-epartograph-app/src"
  "packages/modify-pr/.patches"
)

for d in "${dirs[@]}"; do
  mkdir -p "$ROOT/$d"
done

for entry in "${CONTENT_PACKAGES[@]}"; do
  IFS=':' read -r dir artifact description <<<"$entry"
  mk_content_pkg "$ROOT/content-packages/$dir" "$artifact" "$description"
done

find "$ROOT" -path "$ROOT/.git" -prune -o -type d -empty -exec touch {}/.gitkeep \;

echo "Scaffolded LiberiaEMR under: $(cd "$ROOT" && pwd)"
