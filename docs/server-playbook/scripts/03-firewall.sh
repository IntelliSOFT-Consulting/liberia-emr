#!/usr/bin/env bash
# 03-firewall.sh - default deny inbound; SSH only from admin IPs
# Usage: ADMIN_IPS="203.0.113.10 203.0.113.11" ./03-firewall.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
ADMIN_IPS="${ADMIN_IPS:?Set ADMIN_IPS (space-separated)}"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

for ip in $ADMIN_IPS; do
  ufw allow from "$ip" to any port 22 proto tcp comment 'admin ssh'
done
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'

ufw logging on
ufw --force enable
ufw status verbose
echo "03 firewall active. Reminder: Docker-published ports bypass ufw. Bind internal services to 127.0.0.1."
