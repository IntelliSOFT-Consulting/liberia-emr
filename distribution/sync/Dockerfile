# LiberiaEMR sync sender (facility -> central push)
#
# Wraps the dbsync sender application from mekomsolutions/openmrs-dbsync, the deployable
# sender chosen by ADR 0008. The version is pinned in distribution/distro.properties
# (sync.dbsync) and passed in as DBSYNC_VERSION by scripts/build/build-distribution.sh.
#
# The app is BUILT FROM SOURCE here rather than pulled from Mekom's Nexus because the
# stock artefact refuses to start against OpenMRS 2.8.x. patches/ carries the one-line
# whitelist change, with its full justification and test evidence in the patch header.
# Retire the patch (and switch to the released -exe.jar) once upstream supports 2.8.
#
# Configuration is rendered at start-up from environment variables; see
# docker-entrypoint.sh for the contract and README.md for how to run it.

FROM maven:3.9-eclipse-temurin-17 AS build

ARG DBSYNC_VERSION
RUN [ -n "$DBSYNC_VERSION" ] || { echo "DBSYNC_VERSION build-arg is required (sync.dbsync in distro.properties)" >&2; exit 2; }

WORKDIR /src
RUN curl -sfL "https://github.com/mekomsolutions/openmrs-dbsync/archive/refs/tags/${DBSYNC_VERSION}.tar.gz" \
      | tar xz --strip-components=1

COPY patches/ /patches/
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends patch \
    && rm -rf /var/lib/apt/lists/* \
    && for p in /patches/*.patch; do patch -p1 < "$p"; done

# Only the sender and what it needs. The receiver image is central's and is built
# separately when it lands (PR for the broker and receiver).
RUN mvn -B -q -DskipTests -pl api,sender-app -am package


FROM eclipse-temurin:17-jre

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
ARG DBSYNC_VERSION
LABEL org.opencontainers.image.title="LiberiaEMR Sync Sender" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia" \
      lr.gov.moh.liberiaemr.dbsync.version="${DBSYNC_VERSION}"

# gettext-base provides envsubst, which the entrypoint uses to render the configuration.
# Rendering with the shell instead would evaluate backticks and $( ) inside credential
# values, which is an injection path from the env file into this container.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --home-dir /opt/eip --shell /usr/sbin/nologin eip \
    && mkdir -p /opt/eip /app/config \
    && chown -R eip:eip /opt/eip /app

COPY --from=build --chown=eip:eip /src/sender-app/target/dbsync-sender-*-exe.jar /app/sender.jar
COPY --chown=eip:eip application.properties.template docker-entrypoint.sh /app/

# /opt/eip is the durable state: the Debezium offset and schema history, and the logs.
# It MUST be a volume that survives container replacement, or the sender loses its place
# in the binlog (docs/architecture/sync-eip.md section 1.5).
VOLUME /opt/eip

USER eip
WORKDIR /app
ENTRYPOINT ["/app/docker-entrypoint.sh"]
