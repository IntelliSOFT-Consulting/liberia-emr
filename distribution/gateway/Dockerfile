# LiberiaEMR TLS gateway
#
# Terminates TLS in front of the frontend and backend. Certificates are MOUNTED at run
# time (see TLS_CERT_DIR), never baked into the image.
FROM nginx:1.27-alpine

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Gateway" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

COPY nginx.conf /etc/nginx/conf.d/default.conf
