# LiberiaEMR sync broker (liberia-emr-broker). See README.md.

# Prometheus metrics plugin, built from source: 2.3.0 is the last line on javax servlets,
# which Artemis 2.33's embedded Jetty needs. Pinned to the commit behind tag v2.3.0.
FROM maven:3.9-eclipse-temurin-17 AS metrics-plugin
ARG METRICS_PLUGIN_COMMIT=24eb8d605321637a92ad2ca1f4bea9154034e8db
WORKDIR /src
RUN curl -fsSL "https://github.com/rh-messaging/artemis-prometheus-metrics-plugin/archive/${METRICS_PLUGIN_COMMIT}.tar.gz" \
      | tar xz --strip-components=1 \
    && mvn -B -q -DskipTests package \
    && cp artemis-prometheus-metrics-plugin/target/artemis-prometheus-metrics-plugin-*.jar /plugin.jar \
    && cp artemis-prometheus-metrics-plugin-servlet/target/*.war /metrics.war

FROM apache/activemq-artemis:2.33.0

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Sync Broker" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

USER root
# The base image declares /var/lib/artemis-instance a volume, so an instance there would be
# shadowed by the previous container's volume on every upgrade. It lives under /opt instead.
RUN /opt/activemq-artemis/bin/artemis create /opt/liberiaemr-broker \
      --name liberiaemr-sync --user unused --password "$(head -c 24 /dev/urandom | base64)" \
      --require-login --no-autotune --silent \
    && sed -i '/<web /,/<\/web>/c\   <web path="web">\n       <binding name="metrics" uri="http://0.0.0.0:8161">\n           <app name="metrics" url="metrics" war="metrics.war"/>\n       </binding>\n   </web>' \
         /opt/liberiaemr-broker/etc/bootstrap.xml \
    && grep -q 'war="metrics.war"' /opt/liberiaemr-broker/etc/bootstrap.xml \
    && ! grep -q 'console.war' /opt/liberiaemr-broker/etc/bootstrap.xml \
    && mkdir -p /var/lib/artemis-data \
    && chown -R artemis:artemis /opt/liberiaemr-broker /var/lib/artemis-data

COPY --from=metrics-plugin /plugin.jar /opt/liberiaemr-broker/lib/artemis-prometheus-metrics-plugin.jar
COPY --from=metrics-plugin /metrics.war /opt/activemq-artemis/web/metrics.war
COPY --chown=artemis:artemis etc/login.config /opt/liberiaemr-broker/etc/
COPY --chown=artemis:artemis etc/broker.xml /opt/liberiaemr-broker/etc/broker.xml.tmpl
COPY docker-entrypoint.sh /docker-entrypoint.sh

USER artemis
VOLUME /var/lib/artemis-data

# 61617: facilities and receiver (publish). 8161: metrics for Prometheus (internal network only).
EXPOSE 61617 8161
ENTRYPOINT ["/docker-entrypoint.sh"]
