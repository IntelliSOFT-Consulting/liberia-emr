#!/usr/bin/env bash
# 04-fail2ban.sh - install and configure Fail2Ban using jail.local overrides
# Usage: ADMIN_IPS="203.0.113.10 203.0.113.11" ./04-fail2ban.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
ADMIN_IPS="${ADMIN_IPS:?Set ADMIN_IPS (space-separated)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y install fail2ban
# CentOS/RHEL family: dnf install -y epel-release && dnf install -y fail2ban

# jail.conf is never edited. Overrides go in jail.local.
tee /etc/fail2ban/jail.local >/dev/null <<EOF
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 ${ADMIN_IPS}
bantime  = 10m
findtime = 10m
maxretry = 5

[sshd]
enabled  = true
port     = ssh
maxretry = 3
bantime  = 7d

# Repeat offenders: ban for a week after 3 bans within a day
[recidive]
enabled  = true
logpath  = /var/log/fail2ban.log
bantime  = 1w
findtime = 1d
maxretry = 3
EOF

systemctl enable fail2ban
systemctl restart fail2ban
sleep 2
fail2ban-client status
fail2ban-client status sshd
echo "04 Fail2Ban active."
