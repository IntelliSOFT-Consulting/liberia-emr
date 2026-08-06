# LiberiaEMR backend image
#
# = OpenMRS WAR + exact OMOD versions + Initializer + the RESOLVED content configuration.
# Immutable and versioned (liberia-emr-backend:x.y.z). A mutable git checkout is NEVER
# mounted into a production container. See IMPLEMENTATION.md §8.

# ---------------------------------------------------------------------------
# Stage 1 — resolve content packages into a single Initializer configuration tree
# ---------------------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-17 AS content

WORKDIR /build

# Dependency resolution first so the layer caches across content edits.
COPY pom.xml /build/pom.xml
COPY content-packages /build/content-packages
RUN mvn -B -q -DskipTests package

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
# `jar` stands in for unzip, which the Maven image does not carry — the JDK is already here.
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
      zip=$(find /build/content-packages -name "${pkg}-*.zip" -path '*/target/*' | head -n1); \
      [ -n "$zip" ] || { echo "missing content package: ${pkg}" >&2; exit 1; }; \
      echo "unpacking ${pkg}"; \
      rm -rf /tmp/pkg; mkdir -p /tmp/pkg; \
      (cd /tmp/pkg && jar xf "$zip"); \
      [ -d /tmp/pkg/configuration/backend_configuration ] \
        || { echo "no backend_configuration in ${pkg}" >&2; exit 1; }; \
      # The demo layer loads last, which is right for values a trainee should see and wrong
      # for the address format: addresshierarchy/addressConfiguration.xml has a name the
      # module hardcodes, so demo's Cambodia hierarchy would REPLACE the national one — and
      # <wipe>true</wipe> means replace, not merge. Registration would then teach the wrong
      # form. Dropped here rather than deleted from content-demo, which is lifted verbatim
      # from upstream (scripts/build/lift-demo-content.sh).
      if [ "$pkg" = "${DEMO_PACKAGE}" ]; then \
        rm -rf /tmp/pkg/configuration/backend_configuration/addresshierarchy; \
      fi; \
      cp -R /tmp/pkg/configuration/backend_configuration/. /openmrs_config/; \
    done; \
    rm -rf /tmp/pkg; \
    # A resolved configuration must never contain demo content.
    if [ -d /openmrs_config/demo ]; then echo "demo content leaked into the build" >&2; exit 1; fi

# ---------------------------------------------------------------------------
# Stage 2 — runtime
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
USER 1001

# OMODs resolved from distro.properties by scripts/build/build-distribution.sh into
# distribution/backend/modules/ before `docker build`. The build context is the repository
# root — it has to be, for the content stage to reach content-packages/ — so this path is
# relative to the root and not to this Dockerfile.
COPY distribution/backend/modules/ /openmrs/distribution/openmrs_modules/

# Initializer reads this tree on startup and applies backend_configuration/**.
COPY --from=content /openmrs_config/ /openmrs/distribution/openmrs_config/

# Initializer runs in the safest mode: fail the startup rather than half-apply metadata.
ENV OMRS_CONFIG_INITIALIZER_STARTUP_LOAD=continue_on_error=false
