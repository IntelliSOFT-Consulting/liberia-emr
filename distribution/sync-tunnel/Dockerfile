# LiberiaEMR sync tunnel (liberia-emr-sync-tunnel)
#
# Carries facility to central sync over HTTPS on 443 (LE-372, ADR 0014): wstunnel, a WebSocket
# tunnel, run as a server at central behind the gateway's /sync/broker/ route and as a client
# at each facility. What each end runs is set by its compose file.
#
# Upstream's release image (BSD-3-Clause), pinned by digest so every release carries exactly
# this binary, and published to our registry so an upstream change or outage cannot stop a
# facility from deploying or syncing. Bump the tag and the digest together, deliberately.
FROM ghcr.io/erebe/wstunnel:v10.7.1@sha256:4bab245f0c77be62fd80213e1c785410b7e4b8c50f18fbe219499e6e89ec4952

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Sync Tunnel" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"
