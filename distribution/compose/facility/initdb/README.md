# initdb

Mounted read-only at `/docker-entrypoint-initdb.d` in the `db` service. MariaDB runs
everything here **once**, on the first boot of an empty data volume, and never again — so
this is not a migration mechanism. OpenMRS owns the schema through Liquibase, and metadata
belongs in a content package.

Legitimate uses are the few things that have to be true before OpenMRS first connects:
session variables, a restored backup when standing a facility back up, a grant the
application user cannot create for itself.

`05-openmrs-db-user.sh` creates the OpenMRS application user from `MYSQL_USER` and
`MYSQL_PASSWORD`, in place of the image's `MARIADB_USER`, and runs first because the others
grant that user more.
`10-sync-db-users.sh` creates the sync layer's database principals (a Debezium
replication user and the sender's management schema) and does nothing unless their
passwords are set in the environment. `20-etl-db-user.sh` creates the reporting ETL schema
`liberiaemr_etl` and its user, and lets the OpenMRS user read that schema (ADR 0010); it does
nothing unless `ETL_DB_PASSWORD` is set. `30-etl-sync-queue-grant.sh` lets the ETL user read the
sync sender's queue metadata (column-level, LE-354). The sender creates those tables on its
first start, after initdb, so the script leaves a root-owned event that applies the grant once
the tables exist and then drops itself; it does nothing unless both `SYNC_MGMT_DB_PASSWORD` and
`ETL_DB_PASSWORD` are set.

**No password in the binlog.** This database keeps a ROW binlog for up to 99 days for the
sync sender, and a `CREATE USER ... IDENTIFIED BY` or `ALTER USER` logged there is a clear-text
password on disk for that long (LE-361). Every script here that names a password runs
`SET SESSION sql_log_bin = 0` first, and so must anyone running these statements by hand on an
existing database. The image's own `MARIADB_USER`/`MARIADB_PASSWORD` creation does not, which
is why the compose file no longer sets them. `qa/sync/verify-binlog-secrets.sh` boots this
database and fails if the binlog holds `IDENTIFIED BY` or any of the passwords; to clean an
existing facility, see [binlog-credentials.md](../../../../docs/runbooks/binlog-credentials.md).

Compose bind-mounts this
directory by relative path, and
Docker creates a missing bind source as a root-owned directory — so an absent `initdb/`
does not fail the stack, it silently appears in a working tree owned by root.
