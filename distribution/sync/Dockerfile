# LiberiaEMR sync images (facility -> central push)
#
# One build, two images: the dbsync SENDER (runs at each facility) and the dbsync
# RECEIVER (runs at central), both from mekomsolutions/openmrs-dbsync at the tag pinned
# as sync.dbsync in distribution/distro.properties. scripts/build/build-distribution.sh
# builds each with --target:
#
#   docker build --target sender   -t .../liberia-emr-sync:<v> ...
#   docker build --target receiver -t .../liberia-emr-sync-receiver:<v> ...
#
# Built from source because the stock artefacts refuse OpenMRS 2.8.x, which both ends
# run; patches/ carries the whitelist change and its tracking. Configuration renders
# from environment variables at start-up; contracts are in the entrypoint scripts.

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

RUN mvn -B -q -DskipTests -pl api,sender-app,receiver-app -am package


# Shared runtime base for both apps: JRE, envsubst for config rendering (shell rendering
# would evaluate backticks and $( ) inside credential values, an injection path from the
# env file into the container), and an unprivileged user owning the durable state dir.
FROM eclipse-temurin:17-jre AS runtime-base

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --home-dir /opt/eip --shell /usr/sbin/nologin eip \
    && mkdir -p /opt/eip /app/config \
    && chown -R eip:eip /opt/eip /app

# /opt/eip is the durable state and MUST be a volume that survives container
# replacement: for the sender it holds the Debezium offset and schema history
# (docs/architecture/sync-eip.md section 1.5); for the receiver, complex-obs staging
# (both apps log to the console).
VOLUME /opt/eip
USER eip
WORKDIR /app


FROM runtime-base AS sender

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
ARG DBSYNC_VERSION
LABEL org.opencontainers.image.title="LiberiaEMR Sync Sender" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia" \
      lr.gov.moh.liberiaemr.dbsync.version="${DBSYNC_VERSION}"

COPY --from=build --chown=eip:eip /src/sender-app/target/dbsync-sender-*-exe.jar /app/sender.jar
COPY --chown=eip:eip application.properties.template docker-entrypoint.sh /app/

ENTRYPOINT ["/app/docker-entrypoint.sh"]


FROM runtime-base AS receiver

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
ARG DBSYNC_VERSION
LABEL org.opencontainers.image.title="LiberiaEMR Sync Receiver" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia" \
      lr.gov.moh.liberiaemr.dbsync.version="${DBSYNC_VERSION}"

COPY --from=build --chown=eip:eip /src/receiver-app/target/dbsync-receiver-*-exe.jar /app/receiver.jar
COPY --chown=eip:eip receiver-application.properties.template docker-entrypoint-receiver.sh /app/

ENTRYPOINT ["/app/docker-entrypoint-receiver.sh"]
