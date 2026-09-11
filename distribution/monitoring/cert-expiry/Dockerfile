# LiberiaEMR certificate expiry exporter (liberia-emr-cert-expiry)
#
# Reads the sync broker's mounted enrolment and exposes certificate and revocation-list
# expiry on :9101/metrics for the central Prometheus. See cert-expiry.sh.

FROM alpine:3.20.3

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Certificate Expiry Exporter" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

RUN apk add --no-cache openssl busybox-extras \
    && adduser -D -H -u 10001 exporter
COPY --chmod=755 cert-expiry.sh /usr/local/bin/cert-expiry.sh

USER exporter
EXPOSE 9101
ENTRYPOINT ["/usr/local/bin/cert-expiry.sh"]
