#!/usr/bin/env bash
# 02-ssh.sh - key-only SSH for the admin user
# Usage: ADMIN_USER=youruser ./02-ssh.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
ADMIN_USER="${ADMIN_USER:?Set ADMIN_USER}"
KEYS="/home/${ADMIN_USER}/.ssh/authorized_keys"

# Safety check: never disable passwords without a working key in place
[ -s "$KEYS" ] || { echo "No authorized_keys for ${ADMIN_USER}. Aborting to avoid lockout."; exit 1; }

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
AllowUsers ${ADMIN_USER}
LogLevel VERBOSE
Banner /etc/issue.net
EOF

sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "02 SSH hardened. Open a NEW session to test before closing this one."
