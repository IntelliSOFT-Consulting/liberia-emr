#!/usr/bin/env bash
# 05-docker.sh - safer Docker daemon defaults
# Restarts Docker. Run in a maintenance window.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }

mkdir -p /etc/docker
if [ -f /etc/docker/daemon.json ]; then
  cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%F-%H%M)"
  echo "Existing daemon.json backed up. Merge its settings into the new file if needed."
fi

tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false
}
EOF

systemctl restart docker
docker info --format 'Logging driver: {{.LoggingDriver}}'
echo "05 Docker configured."
echo "Compose reminders: publish ports as 127.0.0.1:HOST:CONTAINER for anything Nginx proxies,"
echo "avoid 'privileged: true', and never mount /var/run/docker.sock into application containers."
