#!/usr/bin/env bash
# 02-ssh.sh - key-only SSH for the admin user
# Usage: ADMIN_USER=youruser ./02-ssh.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
ADMIN_USERS="${ADMIN_USERS:-${ADMIN_USER:-}}"
[ -n "$ADMIN_USERS" ] || { echo "Set ADMIN_USERS (space-separated) or ADMIN_USER"; exit 1; }

# Safety check: every listed user must exist and have a key, or we abort before locking anyone out
for u in $ADMIN_USERS; do
  id "$u" >/dev/null 2>&1 || { echo "User ${u} does not exist."; exit 1; }
  home="$(getent passwd "$u" | cut -d: -f6)"
  [ -s "${home}/.ssh/authorized_keys" ] || { echo "No authorized_keys for ${u}. Aborting to avoid lockout."; exit 1; }
done

echo "Authorized use only. Activity on this system is logged and monitored." | tee /etc/issue.net >/dev/null

# 00- prefix so this file is read before cloud-init drop-ins (first value wins)
tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
AllowUsers ${ADMIN_USERS}
LogLevel VERBOSE
Banner /etc/issue.net
EOF

sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "02 SSH hardened. Open a NEW session to test before closing this one."
