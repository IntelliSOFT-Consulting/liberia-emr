# LiberiaEMR backend image
#
# = OpenMRS WAR + exact OMOD versions + Initializer + the RESOLVED content configuration.
# Immutable and versioned (liberia-emr-backend:x.y.z). A mutable git checkout is NEVER
# mounted into a production container. See IMPLEMENTATION.md §8.

# ---------------------------------------------------------------------------
# Stage 1 — resolve content packages into a single Initializer configuration tree
# ---------------------------------------------------------------------------
# content-packages/*/target/*.zip are expected to already exist in the build context: every
# caller (scripts/build/build-distribution.sh, docs/runbooks/local-development.md §2) runs
# `mvn package` on the host immediately before `docker build`. This used to run that SAME
# `mvn clean package` again in here, from a bare COPY of content-packages/ with no OCL/CIEL
# exports and no host Maven cache — a second, redundant reactor build whose only effect was to
# throw away the host's just-built zips and rebuild identical ones. Reusing them instead cuts a
# full Maven build off both docker-build and e2e in CI, and off the local edit/rebuild loop.
#
# eclipse-temurin, not the maven image: nothing in this stage invokes mvn any more, only jar
# (from the JDK) to unpack the zips below.
FROM eclipse-temurin:17-jdk AS content

WORKDIR /build

COPY content-packages/*/target/*.zip /build/zips/

# Layer order is load order: later layers override earlier ones.
# The site layer is chosen at build time; default is Careysburg.
ARG SITE_PACKAGE=liberiaemr-site-careysburg

# Demo content is opt-in and EMPTY BY DEFAULT: a build that does not ask for it cannot get
# it. scripts/build/build-distribution.sh sets this to liberiaemr-demo only under --demo,
# and refuses to run no-demo-in-release.sh past it. It loads last, after the site layer,
# because a training instance is meant to show demo values.
ARG DEMO_PACKAGE=

# A content package is configuration/{backend,frontend}_configuration/ plus
# content.properties, but Initializer reads the DOMAIN directories (concepts/,
# encountertypes/, …) at the root of the configuration tree. So each package contributes the
# CONTENTS of its backend_configuration/, not the archive as it stands: unpacking the whole
# ZIP would bury every domain two levels down, where Initializer looks straight past it and
# applies nothing — with no error, because an empty configuration is a legal one.
#
# frontend_configuration/ is not copied here on purpose. It belongs to the frontend image,
# which collects it in the same layer order (scripts/build/collect-frontend-config.sh).
#
# `jar` stands in for unzip, which this image does not carry separately — the JDK already has it.
RUN set -eu; \
    mkdir -p /openmrs_config; \
    for pkg in liberiaemr-common \
               liberiaemr-national \
               liberiaemr-mch \
               liberiaemr-lab \
               liberiaemr-pharmacy \
               liberiaemr-opd-ipd \
               "${SITE_PACKAGE}" \
               ${DEMO_PACKAGE}; do \
      set -- /build/zips/"${pkg}"-*.zip; \
      [ -f "$1" ] && [ "$#" -eq 1 ] \
        || { echo "expected exactly one content package: ${pkg}" >&2; exit 1; }; \
      zip="$1"; \

      echo "unpacking ${pkg}"; \
      rm -rf /tmp/pkg; mkdir -p /tmp/pkg; \
      (cd /tmp/pkg && jar xf "$zip"); \
      # content-central's backend layer holds nothing of its own yet, and an empty directory
      # may not survive into its ZIP; the site locations are added below instead.
      if [ "$pkg" = "liberiaemr-central" ] && [ ! -d /tmp/pkg/configuration/backend_configuration ]; then \
        continue; \
      fi; \
      [ -d /tmp/pkg/configuration/backend_configuration ] \
        || { echo "no backend_configuration in ${pkg}" >&2; exit 1; }; \
      # The demo layer loads last, which is right for values a trainee should see and wrong
      # for the address format: addresshierarchy/addressConfiguration.xml has a name the
      # module hardcodes, so demo's Cambodia hierarchy would REPLACE the national one — and
      # <wipe>true</wipe> means replace, not merge. Registration would then teach the wrong
      # form. Dropped here rather than deleted from content-demo, which is lifted verbatim
      # from upstream (scripts/build/lift-demo-content.sh).
      # The same goes for the RefApp demo queue dictionary (LE-395). Its 'Waiting' and
      # 'Emergency' take the names of the national queue status and priority (CIEL 167407 and
      # 1882), which then fail to load as duplicates, and with them the national status and
      # priority sets: every queue-entry search sent the missing status and answered 500
      # "Unable to find concept". The two RefApp demo queues are built on that dictionary's
      # services, so they go too; a training stack uses the site's own queues.
      # scripts/build/build-distribution.sh leaves the same files out of its name check.
      if [ "$pkg" = "${DEMO_PACKAGE}" ]; then \
        rm -rf /tmp/pkg/configuration/backend_configuration/addresshierarchy; \
        rm -f /tmp/pkg/configuration/backend_configuration/ocl/openmrs_DemoQueueConcepts_*.zip \
              /tmp/pkg/configuration/backend_configuration/queues/queues-core_demo.csv; \
      fi; \
      cp -R /tmp/pkg/configuration/backend_configuration/. /openmrs_config/; \
    done; \
    # Central (LE-339, ADR 0012): records from EVERY facility reference that facility's own
    # locations, and location rows are not synced, so central loads the locations/ of every
    # site package in the build context and nothing else of theirs (no ID sequences, cash
    # points, queues or facility global properties). Sites are discovered, not listed, so a
    # new site package reaches central without editing this file. A file name two sites share
    # would silently shadow one of them, so that fails the build.
    if [ "${SITE_PACKAGE}" = "liberiaemr-central" ]; then \
      sites=0; \
      mkdir -p /openmrs_config/locations; \
      for zip in /build/zips/liberiaemr-site-*.zip; do \
        [ -f "$zip" ] || continue; \
        echo "central: adding the locations of $(basename "$zip")"; \
        rm -rf /tmp/pkg; mkdir -p /tmp/pkg; \
        (cd /tmp/pkg && jar xf "$zip"); \
        src=/tmp/pkg/configuration/backend_configuration/locations; \
        [ -d "$src" ] || { echo "no locations/ in $(basename "$zip")" >&2; exit 1; }; \
        for f in "$src"/*; do \
          [ -f "$f" ] || continue; \
          case "$(basename "$f")" in .*) continue ;; esac; \
          dest="/openmrs_config/locations/$(basename "$f")"; \
          [ ! -e "$dest" ] || { echo "two layers ship $(basename "$f")" >&2; exit 1; }; \
          cp "$f" "$dest"; \
        done; \
        sites=$((sites + 1)); \
      done; \
      [ "$sites" -ge 1 ] || { echo "central: no site package in the build context" >&2; exit 1; }; \
      echo "central: locations from ${sites} site package(s)"; \
      # The national MOH Health Record Number auto-generation option points at the ID source
      # each SITE package defines, with that site's HRN prefix, and central loads no site ID
      # source. Central is not a point-of-care system (sync-eip.md) and must not issue a
      # facility-scoped identifier, so the option is dropped here rather than satisfied.
      rm -f /openmrs_config/autogenerationoptions/autogenerationoptions-national.csv; \
    fi; \
    rm -rf /tmp/pkg; \
    # A resolved configuration must never contain demo content.
    if [ -d /openmrs_config/demo ]; then echo "demo content leaked into the build" >&2; exit 1; fi

# ---------------------------------------------------------------------------
# Stage 2 — build the in-tree liberiaemr OMOD
# ---------------------------------------------------------------------------
# This module is NOT pinned in distro.properties and NOT resolved by
# scripts/build/resolve-modules.sh, on purpose. Every OMOD that script fetches is a
# released artifact on mavenrepo.openmrs.org; liberiaemr lives in this repository and has
# never been published there, so a pin would name a coordinate that cannot resolve and the
# resolver's own count check would fail the build.
#
# Building it from the source in THIS commit is the stronger guarantee anyway: the omod in
# the image is exactly the code the tag contains, with no coordinate to drift. It also
# closes the gap the module README used to paper over — dropping a hand-built .omod into a
# running container, which §8 forbids, since a mutable checkout never reaches production.
FROM maven:3.9-eclipse-temurin-17 AS module

# The module's own pom carries an x.y.z-SNAPSHOT on main: that is its DEVELOPMENT stream, which
# .github/workflows/modules.yml re-deploys to Repsy on every merge to main. An image must
# never ship a SNAPSHOT omod (IMPLEMENTATION.md section 6/11), so the version is stamped to
# the distribution version this image IS, and the module is then traceable to the release
# that carries it.
#
# scripts/build/build-distribution.sh refuses a SNAPSHOT or `latest` --version, so for any
# release build this is a concrete version. A bare `docker build` with no --build-arg falls
# back to the pom's own version, which is the right behaviour for a local experiment.
ARG LIBERIAEMR_VERSION=

WORKDIR /build
# The module's content UUIDs (liberiaemr-uuids.properties: the Health Facility tag the identity
# service resolves a record's facility with, what the remote history endpoint returns, and
# module-access ownership evidence) are filtered in from the content layers' variables.properties
# (ADR 0010 decision 7), and the api build fails if one is unresolved.
COPY content-packages/content-common/configuration/variables.properties /build/content-packages/content-common/configuration/variables.properties
COPY content-packages/content-liberia-national/configuration/variables.properties /build/content-packages/content-liberia-national/configuration/variables.properties
COPY content-packages/content-liberia-mch/configuration/variables.properties /build/content-packages/content-liberia-mch/configuration/variables.properties
COPY content-packages/content-liberia-opd-ipd/configuration/variables.properties /build/content-packages/content-liberia-opd-ipd/configuration/variables.properties
COPY modules/liberiaemr /build/liberiaemr
# Tests run in CI's own backend-module job; repeating them here would add minutes to every
# image build for a signal the pipeline already has.
#
# The last check is not belt-and-braces: a SNAPSHOT omod reaching the runtime stage means the
# stamp silently did not apply, and the image would ship the very thing §6/§11 forbids.
#
# The comment stays OUT of the RUN below. Docker strips a `#` line inside a line
# continuation, which leaves an empty continuation and a NoEmptyContinuation warning.
RUN set -eu; \
    if [ -n "${LIBERIAEMR_VERSION}" ]; then \
      echo "stamping the module as ${LIBERIAEMR_VERSION}"; \
      mvn -B -q -f /build/liberiaemr/pom.xml \
        org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
        -DnewVersion="${LIBERIAEMR_VERSION}" -DgenerateBackupPoms=false; \
    fi; \
    mvn -B -q -f /build/liberiaemr/pom.xml -DskipTests \
      -Dliberiaemr.content.dir=/build/content-packages clean package; \
    ls /build/liberiaemr/omod/target/*.omod; \
    if ls /build/liberiaemr/omod/target/*SNAPSHOT*.omod >/dev/null 2>&1 \
       && [ -n "${LIBERIAEMR_VERSION}" ]; then \
      echo "FAIL: module still SNAPSHOT after stamping ${LIBERIAEMR_VERSION}" >&2; exit 1; \
    fi

# --- mamba-etl-liberiaemr (modules/mambaetl, ADR 0010 decisions 1, 2 and 7) ---------------
# Built, stamped and SNAPSHOT-guarded exactly like liberiaemr above. Its api module compiles
# the ETL SQL inside `package`, with core's compile.sh, which needs jq and rsync; this image
# ships neither. The content layers' variables.properties are the filter inputs for ${var.*}
# in _etl, copied to the same place relative to the module as in the repository. Site
# packages, content-central and content-demo are deliberately not copied: ETL output must not
# vary by site. mamba-core-api is bundled inside this OMOD and never pinned in distro.properties.
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq rsync \
    && rm -rf /var/lib/apt/lists/*
COPY content-packages/content-common/configuration/variables.properties /build/content-packages/content-common/configuration/
COPY content-packages/content-liberia-national/configuration/variables.properties /build/content-packages/content-liberia-national/configuration/
COPY content-packages/content-liberia-mch/configuration/variables.properties /build/content-packages/content-liberia-mch/configuration/
COPY content-packages/content-liberia-lab/configuration/variables.properties /build/content-packages/content-liberia-lab/configuration/
COPY content-packages/content-liberia-pharmacy/configuration/variables.properties /build/content-packages/content-liberia-pharmacy/configuration/
COPY content-packages/content-liberia-opd-ipd/configuration/variables.properties /build/content-packages/content-liberia-opd-ipd/configuration/
COPY modules/mambaetl /build/modules/mambaetl
RUN set -eu; \
    if [ -n "${LIBERIAEMR_VERSION}" ]; then \
      echo "stamping mamba-etl-liberiaemr as ${LIBERIAEMR_VERSION}"; \
      mvn -B -q -f /build/modules/mambaetl/pom.xml \
        org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
        -DnewVersion="${LIBERIAEMR_VERSION}" -DgenerateBackupPoms=false; \
    fi; \
    mvn -B -q -f /build/modules/mambaetl/pom.xml -DskipTests clean package; \
    ls /build/modules/mambaetl/omod/target/mamba-etl-liberiaemr-*.omod; \
    if ls /build/modules/mambaetl/omod/target/*SNAPSHOT*.omod >/dev/null 2>&1 \
       && [ -n "${LIBERIAEMR_VERSION}" ]; then \
      echo "FAIL: mamba-etl-liberiaemr still SNAPSHOT after stamping ${LIBERIAEMR_VERSION}" >&2; exit 1; \
    fi

# The MOH indicator reports module (ADR 0010 decision 6), built and stamped the same way. Its
# report and design UUIDs are filtered in from the national layer's variables.properties
# (decision 7), so that file is copied to the same relative place it has in the repository, and
# the api build fails if any variable is left unresolved. The ETL block above copies the same
# file to the same place; the COPY is repeated so this step does not depend on that one. Kept
# in its own COPY and RUN so the other in-tree modules' steps stay independent of it.
COPY modules/liberiaemrreports /build/modules/liberiaemrreports
COPY content-packages/content-liberia-national/configuration/variables.properties /build/content-packages/content-liberia-national/configuration/variables.properties
RUN set -eu; \
    if [ -n "${LIBERIAEMR_VERSION}" ]; then \
      mvn -B -q -f /build/modules/liberiaemrreports/pom.xml \
        org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
        -DnewVersion="${LIBERIAEMR_VERSION}" -DgenerateBackupPoms=false; \
    fi; \
    mvn -B -q -f /build/modules/liberiaemrreports/pom.xml -DskipTests \
      -Dliberiaemr.content.dir=/build/content-packages clean package; \
    ls /build/modules/liberiaemrreports/omod/target/*.omod; \
    if ls /build/modules/liberiaemrreports/omod/target/*SNAPSHOT*.omod >/dev/null 2>&1 \
       && [ -n "${LIBERIAEMR_VERSION}" ]; then \
      echo "FAIL: liberiaemrreports still SNAPSHOT after stamping ${LIBERIAEMR_VERSION}" >&2; exit 1; \
    fi

# ---------------------------------------------------------------------------
# Stage 2b — the audit log module (MOH ICT SOP control C1), from pinned upstream source
# ---------------------------------------------------------------------------
# openmrs/openmrs-module-auditlog records every create, update and delete that goes through
# the OpenMRS Hibernate session in auditlog_audit_log. It is what the auditlog.* global
# properties in content-liberia-national's gp-audit.xml configure; without it those GPs
# configure nothing.
#
# It is NOT an omod.* pin because mavenrepo.openmrs.org, the only repository
# scripts/build/resolve-modules.sh reads, has no usable release of it:
#   - org.openmrs.module:auditlog-omod:1.1-1.0.0 there is a DIFFERENT module under the same
#     coordinate (a client-posted event log with its own audit_log table, which never reads
#     auditlog.*, and bundles a -SNAPSHOT api jar);
#   - the real module's 1.1 release exists only on a third-party Repsy repository, and
#     predates two fixes a security control cannot ship without: AUDIT-35 (stored XSS in the
#     audit log viewer, from a person's name) and AUDIT-38 (the list view drops the
#     user from every entry that has one, and throws on the ones that do not).
# So it is built here from the commit pinned in distribution/distro.properties (source.auditlog.*),
# the dbsync precedent. The commit is fetched by its full SHA, so the source cannot move under
# the pin, and the version is stamped so no -SNAPSHOT omod reaches the image. Move it to an
# omod.* pin the day upstream publishes a release containing those fixes.
#
# distro.properties is copied into this stage alone, so a change to any other pin does not
# rebuild the in-tree modules above.
FROM maven:3.9-eclipse-temurin-17 AS auditlog

WORKDIR /build
COPY distribution/distro.properties /build/distro.properties
# No Modify + PR patches: the pinned commit already contains AUDIT-64/65/66, which this stage
# used to apply as patches. To carry one again, restore a patches/auditlog/ COPY and the apply
# loop as in the bedmanagement stage below (packages/modify-pr/README.md).
RUN set -eu; \
    repo="$(sed -n 's/^source\.auditlog\.repository=//p' /build/distro.properties | tr -d '[:space:]')"; \
    commit="$(sed -n 's/^source\.auditlog\.commit=//p' /build/distro.properties | tr -d '[:space:]')"; \
    version="$(sed -n 's/^source\.auditlog\.version=//p' /build/distro.properties | tr -d '[:space:]')"; \
    [ -n "$repo" ] && [ -n "$version" ] \
      || { echo "source.auditlog.repository/.version are not pinned in distro.properties" >&2; exit 1; }; \
    echo "$commit" | grep -qxE '[0-9a-f]{40}' \
      || { echo "source.auditlog.commit must be a full 40-character SHA, got '${commit}'" >&2; exit 1; }; \
    case "$version" in *SNAPSHOT*|*latest*) echo "source.auditlog.version must be a fixed version" >&2; exit 1 ;; esac; \
    git init -q /build/auditlog; \
    cd /build/auditlog; \
    git fetch -q --depth 1 "$repo" "$commit"; \
    git checkout -q FETCH_HEAD; \
    [ "$(git rev-parse HEAD)" = "$commit" ] || { echo "fetched $(git rev-parse HEAD), pinned $commit" >&2; exit 1; }; \
    mvn -B -q org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
      -DnewVersion="$version" -DgenerateBackupPoms=false; \
    mvn -B -q -DskipTests clean package; \
    ls "/build/auditlog/omod/target/auditlog-${version}.omod"

# ---------------------------------------------------------------------------
# Stage 2c — bed management, from pinned upstream source plus a Modify + PR patch
# ---------------------------------------------------------------------------
# The released 7.2.0 (RefApp 3.7.1's pin) makes ending ANY visit require "Assign Beds" and
# "Edit Admission Locations", even for a patient with no bed, so the queue roles could not end
# a visit without bed write access. distribution/backend/patches/bedmanagement/ fixes that;
# packages/modify-pr/.patches/ tracks it until upstream releases the fix.
#
# Built like the auditlog stage above, plus patches: the commit pinned in distro.properties
# (source.bedmanagement.*, the 7.2.0 tag) is fetched by its full SHA, every patch is applied
# in name order and one that no longer applies fails the build, and the version is stamped so
# no -SNAPSHOT omod reaches the image. One extra check: the stamped version must sort above
# the commit's own (distro.properties says why), or a server that still holds the released
# omod could keep loading the unpatched one.
#
# The omod embeds the module's legacy OWA, whose build downloads Node and runs yarn; that is
# most of this stage's time, and it is cached with the stage.
FROM maven:3.9-eclipse-temurin-17 AS bedmanagement

WORKDIR /build
COPY distribution/distro.properties /build/distro.properties
COPY distribution/backend/patches/bedmanagement/ /build/patches/
RUN set -eu; \
    repo="$(sed -n 's/^source\.bedmanagement\.repository=//p' /build/distro.properties | tr -d '[:space:]')"; \
    commit="$(sed -n 's/^source\.bedmanagement\.commit=//p' /build/distro.properties | tr -d '[:space:]')"; \
    version="$(sed -n 's/^source\.bedmanagement\.version=//p' /build/distro.properties | tr -d '[:space:]')"; \
    [ -n "$repo" ] && [ -n "$version" ] \
      || { echo "source.bedmanagement.repository/.version are not pinned in distro.properties" >&2; exit 1; }; \
    echo "$commit" | grep -qxE '[0-9a-f]{40}' \
      || { echo "source.bedmanagement.commit must be a full 40-character SHA, got '${commit}'" >&2; exit 1; }; \
    case "$version" in *SNAPSHOT*|*latest*) echo "source.bedmanagement.version must be a fixed version" >&2; exit 1 ;; esac; \
    git init -q /build/bedmanagement; \
    cd /build/bedmanagement; \
    git fetch -q --depth 1 "$repo" "$commit"; \
    git checkout -q FETCH_HEAD; \
    [ "$(git rev-parse HEAD)" = "$commit" ] || { echo "fetched $(git rev-parse HEAD), pinned $commit" >&2; exit 1; }; \
    base="$(mvn -B -q help:evaluate -Dexpression=project.version -DforceStdout)"; \
    case "$base" in *SNAPSHOT*) echo "source.bedmanagement.commit is a SNAPSHOT (${base}), not a release" >&2; exit 1 ;; esac; \
    [ "${version%%-*}" != "$base" ] \
      && [ "$(printf '%s\n%s\n' "$base" "${version%%-*}" | sort -V | tail -n 1)" = "${version%%-*}" ] \
      || { echo "source.bedmanagement.version ${version} must sort above the commit's own ${base}" >&2; exit 1; }; \
    for p in /build/patches/*.patch; do \
      echo "applying ${p##*/}"; \
      git apply --whitespace=nowarn "$p"; \
    done; \
    mvn -B -q org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
      -DnewVersion="$version" -DgenerateBackupPoms=false; \
    mvn -B -q -DskipTests clean package; \
    ls "/build/bedmanagement/omod/target/bedmanagement-${version}.omod"

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
# Must match war.openmrs in distribution/distro.properties — this image IS the platform, so
# a drift here silently ships a different OpenMRS than the one the pins were tested against.
# TODO: pin to this tag's digest as well, so the tag cannot be moved under us.
FROM openmrs/openmrs-core:2.8.8

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Backend" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

# UPSTREAM WORKAROUND — openmrs/openmrs-core:2.8.8.
#
# Its /openmrs/startup.sh verifies the database credentials by invoking `mariadb`, but the
# image only ships `mysql`. OMRS_DB defaults to 'mysql', so that check always runs, the
# command is never found, all 30 attempts fail and the container exits 1 — on a perfectly
# healthy database. With `restart: unless-stopped` that is an unbreakable crash loop, and the
# log blames the database.
#
# /usr/bin/mysql in this image IS the MariaDB client (Ver 15.1 Distrib 5.5.68-MariaDB) and
# accepts the `--ssl=0` that startup.sh passes, so the name is the entire problem. Root is
# needed only to write the shim; the base image's own user is restored immediately.
#
# Delete this the moment a released openmrs-core ships a startup.sh that calls what it has.
USER root
RUN printf '#!/bin/sh\nexec /usr/bin/mysql "$@"\n' > /usr/local/bin/mariadb \
    && chmod 0755 /usr/local/bin/mariadb \
    && /usr/local/bin/mariadb --version
# MOH ICT SOP A7. OpenMRS 2.8.8 omits session-timeout, so Tomcat's conf/web.xml
# default of 30 minutes applies. startup.sh recopies the WAR and does not replace
# conf/. An application-level session-timeout would override this default.
RUN set -eu; \
    tomcat_web=/usr/local/tomcat/conf/web.xml; \
    grep -q '<session-timeout>30</session-timeout>' "$tomcat_web"; \
    sed -i 's/<session-timeout>30<\/session-timeout>/<session-timeout>10<\/session-timeout>/' "$tomcat_web"; \
    grep -q '<session-timeout>10</session-timeout>' "$tomcat_web"; \
    tmp=$(mktemp -d); \
    (cd "$tmp" && jar xf /openmrs/distribution/openmrs_core/openmrs.war WEB-INF/web.xml); \
    if grep -q '<session-timeout>' "$tmp/WEB-INF/web.xml"; then \
      echo "OpenMRS WEB-INF/web.xml defines session-timeout; Tomcat conf/web.xml will not apply" >&2; \
      exit 1; \
    fi; \
    rm -rf "$tmp"
# UPSTREAM WORKAROUND — openmrs/openmrs-core:2.8.8.
#
# /openmrs/startup-init.sh means to empty the modules, OWA, configuration and frontend
# directories on the openmrs-data volume before copying this image's distribution into them,
# but writes `rm -fR "${OMRS_MODULES_DIR:?}/*"`: the glob is quoted, so it deletes nothing.
# Files from earlier images therefore pile up. Our own OMODs are versioned by commit SHA, so
# an old liberiaemr-<sha>.omod sits beside the new one and OpenMRS may keep the old one —
# central dev ran a two-day-old liberiaemr, liberiaemrreports and mamba-etl through green
# deploys (LE-380). Same for config files a newer content package removed.
#
# Moving the glob outside the quotes restores what upstream intended. The checks fail the
# build if a later base image changes these lines, so the patch is never silently skipped.
RUN set -eu; \
    f=/openmrs/startup-init.sh; \
    for d in OMRS_MODULES_DIR OMRS_OWA_DIR OMRS_CONFIG_DIR OMRS_FRONTEND_DIR; do \
      grep -qF "rm -fR \"\${$d:?}/*\"" "$f"; \
      sed -i "s|rm -fR \"\${$d:?}/\*\"|rm -fR \"\${$d:?}\"/*|" "$f"; \
      grep -qF "rm -fR \"\${$d:?}\"/*" "$f"; \
    done
USER 1001

# OMODs resolved from distro.properties by scripts/build/build-distribution.sh into
# distribution/backend/modules/ before `docker build`. The build context is the repository
# root — it has to be, for the content stage to reach content-packages/ — so this path is
# relative to the root and not to this Dockerfile.
COPY distribution/backend/modules/ /openmrs/distribution/openmrs_modules/

# The in-tree modules, built in stage 2, land beside them. Kept as separate COPYs so it is
# obvious in the layer list which OMODs here are ours and that the rest are resolved pins.
COPY --from=module /build/liberiaemr/omod/target/liberiaemr-*.omod /openmrs/distribution/openmrs_modules/
COPY --from=module /build/modules/mambaetl/omod/target/mamba-etl-liberiaemr-*.omod /openmrs/distribution/openmrs_modules/
COPY --from=module /build/modules/liberiaemrreports/omod/target/liberiaemrreports-*.omod /openmrs/distribution/openmrs_modules/
# Third-party, but built from a pinned commit rather than resolved (stage 2b says why).
COPY --from=auditlog /build/auditlog/omod/target/auditlog-*.omod /openmrs/distribution/openmrs_modules/
# The same for bed management, which replaces the omod.bedmanagement pin (stage 2c says why).
COPY --from=bedmanagement /build/bedmanagement/omod/target/bedmanagement-*.omod /openmrs/distribution/openmrs_modules/

# Initializer reads this tree on startup and applies backend_configuration/**.
COPY --from=content /openmrs_config/ /openmrs/distribution/openmrs_config/

# initializer.startup.load takes ONE of three literal values — continue_on_error,
# fail_on_error, disabled. It was set to 'continue_on_error=false', which is not a negation
# of the first: it is an unrecognised value that fell through to continuing anyway. The
# behaviour was therefore always continue_on_error, and this now says so.
#
# fail_on_error is NOT the safer setting it sounds like, and is deliberately not used here.
# InitializerServiceImpl.loadUnsafe iterates the loaders with no try/catch, so the first
# domain that reports an error propagates out and EVERY LATER DOMAIN IS SKIPPED. With the
# duplicate CIEL drug concepts this distribution currently ships, that aborts at concepts
# (order 500) and silently drops programs, drugs, order frequencies, queues and forms —
# strictly worse than loading past the failures.
#
# The metadata gate does not depend on this setting: qa/upgrade/run-clean-install.sh asserts
# on Initializer's own log, which records the failures under either mode. Switch this to
# fail_on_error only once that gate is green.
ENV OMRS_CONFIG_INITIALIZER_STARTUP_LOAD=continue_on_error
