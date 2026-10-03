#!/usr/bin/env bash
# 01-baseline.sh - OS baseline for a Liberia deployment server (Ubuntu/Debian)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get -y install unattended-upgrades apt-listchanges chrony auditd ufw fail2ban lynis curl ca-certificates
dpkg-reconfigure -f noninteractive unattended-upgrades

timedatectl set-timezone Africa/Monrovia
systemctl enable --now chrony auditd

# Kernel network hardening (ip_forward is left alone because Docker needs it)
tee /etc/sysctl.d/99-hardening.conf >/dev/null <<'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
fs.suid_dumpable = 0
EOF
sysctl --system >/dev/null

# Audit rules for identity, sudo, SSH and Docker configuration changes
tee /etc/audit/rules.d/99-hardening.rules >/dev/null <<'EOF'
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/sudoers -p wa -k sudo
-w /etc/sudoers.d/ -p wa -k sudo
-w /etc/ssh/sshd_config -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd
-w /etc/docker/ -p wa -k docker
EOF
augenrules --load || true

chmod 700 /root
echo "01 baseline complete."
