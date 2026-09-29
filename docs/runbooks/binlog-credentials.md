# Runbook: database passwords in a facility binlog

A facility database keeps a binary log (binlog) for up to 99 days, because the sync sender
reads it. Until LE-361, the database's first boot wrote some account passwords into that
binlog in clear text: anyone who could read the `db-data` volume, or a copy of it, could read
them. A database created with this release or later does not; `qa/sync/verify-binlog-secrets.sh`
checks that in CI.

On a facility database created **before** this release, rotate the affected passwords, then
purge the binlogs that hold the old ones. Central has no binlog and needs nothing.

**Rehearsal status:** the SQL below (the check, `ALTER USER` with the binlog off, `FLUSH` and
`PURGE BINARY LOGS`) was rehearsed on a throwaway facility database. The whole procedure has not
been run at a facility with a live sender; do it first on staging.

Commands assume the repository is checked out on the host. `facility` stands for
`docker compose -f distribution/compose/facility/docker-compose.yml --env-file <facility env>`,
plus `--profile sync` if this facility syncs.

## Which passwords

| Account | Env variable | Leaked |
| --- | --- | --- |
| OpenMRS application user (`MYSQL_USER`) | `MYSQL_PASSWORD` | Always: the image created it with the binlog on |
| Debezium user (`DEBEZIUM_DB_USER`) | `DEBEZIUM_DB_PASSWORD` | If it was set at first boot |
| Sync management user (`SYNC_MGMT_DB_USER`) | `SYNC_MGMT_DB_PASSWORD` | If it was set at first boot |
| `root` | `MYSQL_ROOT_PASSWORD` | No: the image turns the binlog off while it sets it |
| Reporting ETL user (`ETL_DB_USER`) | `ETL_DB_PASSWORD` | No: its script has always turned the binlog off |

## 1. Check

List the account statements in the binlog, with the passwords cut off so they do not reach
the screen:

```bash
facility exec -T db sh -c 'cd /var/lib/mysql && mariadb-binlog -vv binlog.[0-9]*' \
  | grep -i 'IDENTIFIED BY' | sed 's/IDENTIFIED BY.*/IDENTIFIED BY <cut>/I'
```

Each line names an account whose password is in the binlog. If there are none, the files that
held them have already expired; still rotate if the volume or a copy of it has ever left the
host, and skip section 3.

## 2. Rotate

Generate each new password with `openssl rand -hex 24`: hex needs no quoting in SQL, `sed` or
the env file. Do this at a quiet time; the EMR is down for a few minutes.

1. Give the backend its new password. It reads `connection.password` from
   `openmrs-runtime.properties` in the `openmrs-data` volume, not from the env file
   ([local-development.md](local-development.md) explains why), and reads it only at start-up:

   ```bash
   facility exec -u root backend sed -i \
     's/^connection\.password=.*/connection.password=<new MYSQL_PASSWORD>/' \
     /openmrs/data/openmrs-runtime.properties
   ```

2. Stop everything that signs in to the database: `facility stop backend sync` (without the
   sync profile, just `backend`). Stopping the sender also saves its binlog position.
3. Change the passwords in one root session, **with the binlog off first**. Without that first
   line, `ALTER USER` writes the new passwords to the binlog, and this has to be done again.

   ```bash
   facility exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
   ```

   ```sql
   SET SESSION sql_log_bin = 0;
   ALTER USER 'openmrs'@'%' IDENTIFIED BY '<new MYSQL_PASSWORD>';
   ALTER USER 'debezium'@'%' IDENTIFIED BY '<new DEBEZIUM_DB_PASSWORD>';
   ALTER USER 'dbsync_mgmt'@'%' IDENTIFIED BY '<new SYNC_MGMT_DB_PASSWORD>';
   SET SESSION sql_log_bin = 1;
   FLUSH BINARY LOGS;
   SHOW MASTER STATUS;
   ```

   Use the account names in the env file if they differ, and leave out an account section 1 did
   not list. `FLUSH BINARY LOGS` starts a new binlog file; note its name from
   `SHOW MASTER STATUS` (for example `binlog.000042`). Every older file may hold an old password.
4. Put the new passwords in the env file, then `facility up -d`.
5. Check: the EMR login page works and `facility logs backend` shows no `Access denied`; with
   sync, `facility logs sync` shows the sender connected and no `Access denied`.
6. Run section 1 again. It must list the same lines as before and no more; a new line means an
   `ALTER USER` ran with the binlog on.

## 3. Purge the old binlogs

`PURGE BINARY LOGS TO '<file>'` deletes every binlog file before `<file>`.

**Without sync**, purge straight away, to the file you noted in section 2 step 3:

```bash
facility exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "PURGE BINARY LOGS TO '\''binlog.000042'\''"'
```

**With sync**, the sender must not need anything before that file, or it refuses to start
(section 11 of [sync-operations.md](sync-operations.md) is then the way back, and it resends the
whole database). Its saved position moves only when it reads an OpenMRS change, so:

1. Let the facility record something after the rotation: a registration or an encounter.
2. Stop the sender, which saves its position, and read the binlog file that position is in:

   ```bash
   facility stop sync
   facility run --rm --no-deps --entrypoint sh sync -c \
     'grep -ao "binlog\.[0-9]*" /opt/eip/.debezium/offsets.txt | sort -u'
   ```

3. If it names the file you noted or a later one, purge to the file it names; the sender needs
   nothing older. If it names an earlier file, `facility start sync`, let more be recorded, and
   repeat step 2.

   ```bash
   facility exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "PURGE BINARY LOGS TO '\''<file it names>'\''"'
   facility start sync
   ```

4. Check `facility logs sync` shows the sender carrying on, and run section 1: it must list
   nothing.

## 4. Copies

Any copy of the `db-data` volume taken before the purge (a backup of the volume, a snapshot, a
disk image) still holds the old binlogs. After the rotation the passwords in it no longer work,
so it needs no special handling beyond the encryption and retention in
[backup-restore.md](backup-restore.md). Put the new passwords in the MOH secret store copy of
the env file, as that runbook requires.
