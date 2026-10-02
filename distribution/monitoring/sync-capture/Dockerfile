# LiberiaEMR sync capture exporter (liberia-emr-sync-capture)
#
# Reads the sync sender's saved binlog position and the newest rows in the tables it watches,
# and exposes on :9102/metrics whether capture has stopped, and whether the sender can reach
# central. See sync-capture.sh.

FROM alpine:3.20.3

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Sync Capture Exporter" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

RUN apk add --no-cache mariadb-client busybox-extras curl
COPY --chmod=755 sync-capture.sh /usr/local/bin/sync-capture.sh

# The sender's uid and gid (sync/Dockerfile): its offset file is private to that owner.
USER 999:999
EXPOSE 9102
ENTRYPOINT ["/usr/local/bin/sync-capture.sh"]
