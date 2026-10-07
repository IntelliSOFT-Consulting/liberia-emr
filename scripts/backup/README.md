# LiberiaEMR database backups 💾

Encrypted, scheduled backups of the LiberiaEMR MariaDB database, a safe way to
test-restore them before you ever need to for real, and a cron job that keeps
it all running quietly in the background.

Nothing server-specific lives in this repo. The scripts are templates
(`*-template.sh`) with `{{PLACEHOLDER}}` values — your real container names,
paths, and GPG key fingerprint stay in a local `backup.env` file that never
gets committed.

## What's in here

| File | What it does |
|---|---|
| `backup-liberiaemr-db-template.sh` | dumps the DB, gzips it, encrypts it with GPG, prunes old local backups |
| `restore-liberiaemr-db-template.sh` | restores a backup — `--test` mode is a safe dry run, no impact on live data |
| `backup_cron-template.sh` | schedules the backup script to run automatically |
| `render.sh` | fills in your real values, turning templates into runnable scripts |
| `backup.env.example` | copy this to `backup.env` and fill in your details |

## 1. Set up your values

```bash
cd /path/to/repo/liberiaemr-backup
cp backup.env.example backup.env
nano backup.env      # fill in your real container names, paths, GPG fingerprint
```

`backup.env` is git-ignored — it's yours, it stays local, it never gets committed.

## 2. Render and go live

```bash
./render.sh backup.env .        # turns the templates into real, runnable scripts, right here
sudo ./backup_cron.sh           # schedules backup-liberiaemr-db.sh to run automatically
```

That's it — backups now run on the schedule you set (`CRON_SCHEDULE` in
`backup.env`). Nothing else needs to happen for day-to-day operation.

Want to confirm it actually works right now, instead of waiting for the next
scheduled run?
```bash
sudo ./backup-liberiaemr-db.sh
sudo tail /var/log/liberiaemr-backup.log
```

`render.sh` won't write anything if a placeholder is missing a value, if a
value is empty or still says `REPLACE_ME`, or if a value contains shell-special
characters (quotes, `$`, backticks, `;` `&` `|`, etc.) — so a typo in
`backup.env` fails loudly here, not silently later at 2am.

## Restoring a backup 🔧

Two steps, always in this order — never skip the first one.

```bash
cd /path/to/repo/liberiaemr-backup      # (or wherever you rendered/deployed the scripts)

# Step 1 — test it. This loads the backup into a scratch database and checks
# it, then throws the scratch copy away. Your live data is never touched.
sudo ./restore-liberiaemr-db.sh --test /path/to/backups/<file>.sql.gz.gpg

# Step 2 — once you see "TEST PASSED" and you're confident, do the real thing.
# This WILL overwrite your live database. It asks for confirmation, takes a
# safety backup of what's currently live first, and stops the app while it
# restores so nothing writes to a half-loaded database.
sudo ./restore-liberiaemr-db.sh /path/to/backups/<file>.sql.gz.gpg
```

Run the `--test` step regularly, even when nothing's wrong — it's the only way
to actually know your backups are restorable before the day you need one to be.

**If anything else writes to the database directly** (a sync worker, a
reporting job, etc.) — not just the main backend — list it in
`EXTRA_STOP_CONTAINERS` in `backup.env`, comma-separated. A real restore stops
every container in that list plus `BACKEND_CONTAINER` before loading the
backup, and only restarts whichever ones were actually running beforehand.
Something that only talks to the database *through* the backend's API doesn't
need to be listed — stopping the backend already covers it.

## Offsite backups (optional) ☁️

By default, backups only live on this server. If it's ever lost, so are they.
Set `REMOTE_UPLOAD=true` in `backup.env` to send a copy somewhere else too.
`UPLOAD_METHOD` picks how:

- **`UPLOAD_METHOD=rclone`** — for cloud object storage (S3, Linode Object
  Storage, Backblaze B2), Google Drive, or an SFTP server you control. `rclone`
  handles all of these through one config, so this covers almost any target.
- **`UPLOAD_METHOD=scp`** — for a single server you already have SSH key
  access to. No `rclone` install or config needed, just a destination path.

Everything in this section is optional — leave it out of `backup.env`
entirely for local-only backups (`REMOTE_UPLOAD` defaults to `false`). Once you
do want it, you only need to set the one destination that matches your
`UPLOAD_METHOD` — no need to fill in the other one too.

### Option A: `rclone`

Credentials live in `rclone`'s own config file — never in `backup.env`, never
in this repo.

```bash
sudo apt install rclone
sudo rclone config
```

Walk through the prompts — `n` for a new remote, name it anything (this name is
the part before the `:` in `RCLONE_REMOTE`), then pick your storage type:

- `s3` → paste your access key + secret key (use a bucket-scoped credential,
  not an account-wide one, so a leaked key can't reach anything else)
- `drive` → this opens a browser-based Google login instead of pasting keys
- `sftp` → host, username, and either a password or an SSH key path — this is
  the "another server" option

This writes the real credentials to `/root/.config/rclone/rclone.conf`
(since the backup runs as root) — already covered by `.gitignore`.

Then in `backup.env`:
```
REMOTE_UPLOAD=true
UPLOAD_METHOD=rclone
RCLONE_REMOTE=<remote-name>:<bucket-or-folder-path>
```

### Option B: `scp`

Nothing to install or configure beyond SSH key access already working from
this server to the destination — confirm that first:
```bash
ssh backups@your-other-server "echo it works"   # should NOT ask for a password
```
Then in `backup.env`:
```
REMOTE_UPLOAD=true
UPLOAD_METHOD=scp
SCP_DESTINATION=backups@your-other-server:/srv/backups/
```

### Either way

Re-render (`./render.sh backup.env .`) and verify it before trusting cron with it:
```bash
sudo ./backup-liberiaemr-db.sh          # should log "Uploading to ..." then "Upload succeeded"
```
For `rclone`, you can also double-check directly: `sudo rclone lsd <remote-name>:<path>`.

If the upload fails for any reason (bad credentials, network down, wrong SSH
key), the script logs a warning and keeps going — a failed offsite copy never
deletes or loses the local backup that was just made.

One safety net either way: `REMOTE_UPLOAD=true` is refused unless
`ENCRYPT_BACKUPS=true` too — it will never upload plaintext patient data, even
if you flip the flag by mistake.

**Prefer plain `scp` over `rclone`?** If your only offsite target is one other
server you already have SSH access to, you don't strictly need `rclone` —
a simple line added after the backup completes works too:
```bash
scp "${final_file}" youruser@your-other-server:/path/to/backups/
```
(`rclone` is worth it once you want retries, checksums, or more than one kind
of remote — for a single server, plain `scp` is one less moving part.)

## The encryption key 🔑

Restoring needs the **private** key. Keep a copy of it off this server
entirely — offline, or in a password manager — because if this server is ever
lost, that's the only way to read any of your backups back.

The backup job itself only ever needs the **public** key, so day-to-day
operation doesn't need the private key present at all.

The key has an expiry date — extend it before then, or backups will start
failing silently on that date.

## What is and isn't a secret

None of the placeholder values are secrets — they're names, paths, and a
public key fingerprint. The database password is never in these files; the
scripts read it at run time from your compose env file (`ENV_FILE`).

If you later move values to Vault, have Vault Agent render a plain
`KEY=VALUE` `backup.env` and feed that to `render.sh`. Don't point Vault Agent
at the `-template.sh` files directly — they use the same `{{ }}` syntax Vault
templates do, and the two would collide.

## Before you commit ✅

Old copies of these scripts under a different name (say, a renamed
`restore-*.sh` you were testing with) aren't covered by `.gitignore`. Delete
them, then double-check nothing real is staged:

```bash
git add -A
awk -F= '!/^[[:space:]]*#/ && NF>1 { v=$0; sub(/^[^=]*=/,"",v); if (length(v)>5) print v }' backup.env > /tmp/vals.txt
git grep --cached -nFf /tmp/vals.txt -- . ':!*.env.example' && echo "LEAK: do not commit" || echo "clean"
rm -f /tmp/vals.txt
git status --short   # should show only templates, render.sh, this README, .gitignore, backup.env.example
```