#!/usr/bin/env bash
# 06-verify.sh - print the hardening state for the deployment record
# Usage: sudo ./06-verify.sh | tee "verify-$(hostname)-$(date +%F).txt"
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }

echo "== Host and time =="; hostnamectl | head -n 5; timedatectl | grep -E 'Time zone|synchronized'

echo; echo "== SSH effective settings =="
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|allowusers|x11forwarding|allowtcpforwarding) '

echo; echo "== Firewall =="; ufw status verbose

echo; echo "== Fail2Ban =="; fail2ban-client status; fail2ban-client status sshd

echo; echo "== Listening ports =="; ss -tulpn

echo; echo "== Automatic updates =="
systemctl is-enabled unattended-upgrades; apt list --upgradable 2>/dev/null | tail -n +2 | wc -l

echo; echo "== Audit rules loaded =="; auditctl -l | wc -l

if command -v docker >/dev/null; then
  echo; echo "== Privileged containers (should be none) =="
  docker ps -q | xargs -r docker inspect --format '{{.Name}} privileged={{.HostConfig.Privileged}}' | grep 'privileged=true' || echo "none"
  echo; echo "== Containers with ports on all interfaces =="
  docker ps --format '{{.Names}}: {{.Ports}}' | grep '0.0.0.0' || echo "none"
fi

echo; echo "== Lynis audit =="
LYNIS_LOG="lynis-$(hostname)-$(date +%F).log"
LYNIS_REPORT="lynis-$(hostname)-$(date +%F).dat"
lynis audit system --quick --no-colors --logfile "$LYNIS_LOG" --report-file "$LYNIS_REPORT"
echo; echo "== Lynis summary =="
grep -E '^(hardening_index|warning\[\]|suggestion\[\])' "$LYNIS_REPORT"
