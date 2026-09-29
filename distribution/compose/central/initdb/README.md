# initdb

Mounted read-only at `/docker-entrypoint-initdb.d` in the central `db` service. MariaDB
runs everything here **once**, on the first boot of an empty data volume, and never
again, so this is not a migration mechanism. OpenMRS owns the schema through Liquibase,
and metadata belongs in a content package.

Four committed scripts. `05-openmrs-db-user.sh` creates the EMR's account from `MYSQL_USER` and
`MYSQL_PASSWORD`, in place of the image's `MARIADB_USER`, and runs first because the others
grant it more; it is identical to the facility's. `10-sync-mgmt-db.sh` creates the sync receiver's management schema
and its principal, and lets the EMR's account read that schema for the Sync conflicts page;
it does nothing unless `SYNC_MGMT_DB_PASSWORD` is set. `20-identity-db.sh` creates the
`openmrs_identity` schema for the Central Person Identifier, with the EMR's account as its
only writer; the liberiaemr module creates its tables. `30-etl-db-user.sh` creates the
reporting ETL schema `liberiaemr_etl` and its user, and lets the EMR's account read that schema
(ADR 0010); it does nothing unless `ETL_DB_PASSWORD` is set. On a central database that already
exists, run their statements by hand once; initdb will not run again.

Central has no binlog, but the scripts that name a password still run
`SET SESSION sql_log_bin = 0` first, as the facility's must (LE-361), so they stay safe if a
binlog is ever enabled here.

Same rules as the facility's `initdb/`: session variables, restores, and grants the
application user cannot create for itself are the legitimate uses; nothing else.
