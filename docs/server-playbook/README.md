# Liberia Server Playbook

Server provisioning and hardening playbook for OpenMRS and related health application deployments in Liberia. This is a high-level guide. The scripts in [`scripts/`](scripts/) carry out the hardening steps, and the sections below explain when to run them and how to confirm they worked.

## 1. Purpose and scope

The playbook gives every Liberia server the same secure baseline: patched operating system, key-only SSH, a default-deny firewall, automatic blocking of brute-force attempts, a hardened Docker runtime, audit logging and a repeatable verification step.

Scope is the server and the software deployed on it (operating system, SSH, firewall, Docker and application deployment profiles). Physical medical hardware and any environment not covered by the contract are out of scope.

## 2. Assumptions

- Ubuntu LTS or Debian server, reachable over the internet, with root or sudo access for the initial setup.
- Applications run in Docker behind Nginx.
- There is a single deployment target, with no separate staging or production servers.
- Administrators log in with SSH keys from known, fixed IP addresses.
- The server clock uses the Africa/Monrovia time zone and syncs over NTP so logs line up across systems.

## 3. Deployment phases

1. **Prepare.** Confirm the admin username, install your public SSH key for that user, and list the admin IP addresses that will be allowed to connect. Keep a second console or session open until the end.
2. **Baseline.** Patch the system, enable automatic security updates, set time sync, apply kernel network settings and load audit rules (`01-baseline.sh`).
3. **Secure SSH.** Disable root and password logins, limit access to the admin user (`02-ssh.sh`).
4. **Firewall.** Deny all inbound traffic by default and open only SSH from admin IPs plus HTTP and HTTPS (`03-firewall.sh`).
5. **Fail2Ban.** Ban IP addresses that repeatedly fail to log in (`04-fail2ban.sh`).
6. **Docker.** Apply log rotation, no-new-privileges and related runtime defaults, then deploy the application (`05-docker.sh`).
7. **Verify.** Run the verification script and a Lynis audit, then file the output with the deployment record (`06-verify.sh`).

### Running the scripts

Run as root on a fresh server, in order. Set `ADMIN_USER` and `ADMIN_IPS` (space-separated) first. Test every SSH and firewall change from a second session before closing the first one.

```bash
export ADMIN_USER=youruser
export ADMIN_IPS="use server IP"

sudo -E ./scripts/01-baseline.sh
sudo -E ./scripts/02-ssh.sh
sudo -E ./scripts/03-firewall.sh
sudo -E ./scripts/04-fail2ban.sh
sudo -E ./scripts/05-docker.sh
sudo -E ./scripts/06-verify.sh | tee "verify-$(hostname)-$(date +%F).txt"
```

## 4. Hardening baseline

| Control | Requirement | Script | How to check |
|---|---|---|---|
| Patching | Security updates install automatically | 01 | `apt list --upgradable`; unattended-upgrades log |
| Time | NTP sync, Africa/Monrovia | 01 | `timedatectl` |
| Kernel network | Spoofing, redirect and source-routing protections on | 01 | `sysctl -a` with the 99-hardening keys |
| Audit | Changes to accounts, sudo, SSH and Docker config are logged | 01 | `auditctl -l` |
| SSH | Key-only, no root, 3 attempts, admin user only | 02 | `sshd -T` |
| Firewall | Default deny inbound; SSH from admin IPs only | 03 | `ufw status verbose` |
| Brute-force protection | Fail2Ban active with sshd and recidive jails | 04 | `fail2ban-client status sshd` |
| Docker runtime | Log rotation, no-new-privileges, no privileged containers | 05, 06 | `docker info`; script 06 check |

## 5. How Fail2Ban is used

Fail2Ban reads service logs, matches lines against filters (regular expressions for failures such as bad SSH logins), and runs an action, normally a firewall rule that blocks the source IP for a set time. A jail ties together one service, one filter and one action. The main settings are:

- **maxretry:** failures allowed before a ban. SSH uses 3; other jails use 5.
- **findtime:** the window in which those failures are counted.
- **bantime:** how long an address stays blocked.
- **ignoreip:** addresses that are never banned. Add every admin IP here so a mistyped password does not lock the team out.

Never edit `jail.conf` directly, because package updates can overwrite it. Script 04 writes overrides to `jail.local` instead.

## 6. Compliance alignment

The baseline supports the security requirements these deployments target: HIPAA technical safeguards, Liberia's Data Protection Act, the Ministry of Health ICT SOPs and national cybersecurity requirements. The controls above address access control (SSH and firewall), audit logging (auditd, Fail2Ban logs), integrity (patching, Docker settings) and transmission security (HTTPS only exposed). Application-level items such as role-based access, encryption at rest and user training are handled in the application security checklist, not in this playbook.

## 7. Monitoring and incident response

- Review `/var/log/auth.log`, the Fail2Ban log and the ufw log weekly. Look for repeated bans from the same network and for logins from unexpected IP addresses.
- If compromise is suspected: keep the server running, take a snapshot, block the source at the firewall, rotate SSH keys and application credentials, then review audit records for changes to accounts, sudoers and SSH configuration.
- Record each incident with time, source IP, systems touched and actions taken, and report according to the applicable data protection and MOH requirements.

## 8. Backup and recovery

Take a daily backup of the application database and uploaded files, and copy it off the server to separate storage. Test a restore at least once each quarter and keep the result with the deployment record. Backup tooling and the retention period are not fixed by this playbook and need to be agreed for each site.

## 9. Maintenance cadence

| Frequency | Task |
|---|---|
| Weekly | Review auth, Fail2Ban and firewall logs; check pending updates and reboot if a kernel update needs it |
| Monthly | Run script 06 and compare with the previous output; review admin IP list and SSH keys; rebuild and rescan container images |
| Quarterly | Restore test from backup; run a full Lynis audit; review this playbook and the scripts |
| After any change | Re-run script 06 and confirm no control has regressed |

## 10. Items to confirm before use

- **Fail2Ban ban time.** The scripts use 10 minutes as the default and 7 days for the sshd jail. Adjust if the team wants different values.
- **Fail2Ban retries.** 5 by default and 3 for SSH.
- **Admin IP addresses.** Scripts 03 and 04 refuse to run without `ADMIN_IPS`. Use the real admin addresses; the examples here use documentation-only addresses.
- **Docker and the firewall.** Ports published by Docker bypass ufw. Publish internal services on `127.0.0.1` in the compose files and let Nginx be the only public entry point.
- **Nginx in a container.** The `nginx-http-auth` jail cannot read container logs from the host. Enable that jail only if Nginx logs are available on the host.
- **Testing.** The scripts have not been run on a live server. Test on a throwaway VM first.
