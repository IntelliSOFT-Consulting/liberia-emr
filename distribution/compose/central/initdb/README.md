# initdb

Mounted read-only at `/docker-entrypoint-initdb.d` in the central `db` service. MariaDB
runs everything here **once**, on the first boot of an empty data volume, and never
again, so this is not a migration mechanism. OpenMRS owns the schema through Liquibase,
and metadata belongs in a content package.

The one committed script, `10-sync-mgmt-db.sh`, creates the sync receiver's management
schema and its principal, and lets the EMR's account read that schema for the Sync conflicts
page. It does nothing unless `SYNC_MGMT_DB_PASSWORD` is set in the environment. On a central
database that already exists, run its statements by hand once;
initdb will not run again.

Same rules as the facility's `initdb/`: session variables, restores, and grants the
application user cannot create for itself are the legitimate uses; nothing else.
