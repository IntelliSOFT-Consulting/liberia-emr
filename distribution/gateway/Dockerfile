# LiberiaEMR TLS gateway
#
# Terminates TLS in front of the frontend and backend. Certificates are MOUNTED at run
# time (see TLS_CERT_DIR), never baked into the image.
FROM nginx:1.27-alpine

ARG LIBERIAEMR_VERSION=1.0.0-SNAPSHOT
LABEL org.opencontainers.image.title="LiberiaEMR Gateway" \
      org.opencontainers.image.version="${LIBERIAEMR_VERSION}" \
      org.opencontainers.image.vendor="Ministry of Health, Republic of Liberia"

# The config is rendered at start-up: the stock nginx entrypoint runs envsubst over
# /etc/nginx/templates/*.template and writes the result to /etc/nginx/conf.d/, dropping
# the .template suffix. So default.conf.template becomes conf.d/default.conf.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY snippets/ /etc/nginx/snippets/

# Restrict substitution to our own variable. Without this, envsubst would also expand
# any environment name that collides with an nginx runtime variable and silently blank
# out $host, $uri or $request_uri in the rendered config.
ENV NGINX_ENVSUBST_FILTER=^LEGACY_ADMIN_

# Fail safe: the image blocks the legacy admin UI unless an environment deliberately
# sets LEGACY_ADMIN_UI=true. Production never sets it, so production stays blocked even
# if the variable is dropped from a compose file. See docs/security/moh-ict-sop-mapping.md
# control D5 — do not change this default to true.
ENV LEGACY_ADMIN_UI=false
