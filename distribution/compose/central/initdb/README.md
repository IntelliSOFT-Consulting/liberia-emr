# initdb

Mounted read-only at `/docker-entrypoint-initdb.d` in the central `db` service. MariaDB
runs everything here **once**, on the first boot of an empty data volume, and never
again, so this is not a migration mechanism. OpenMRS owns the schema through Liquibase,
and metadata belongs in a content package.

Two committed scripts. `10-sync-mgmt-db.sh` creates the sync receiver's management schema
and its principal, and lets the EMR's account read that schema for the Sync conflicts page;
it does nothing unless `SYNC_MGMT_DB_PASSWORD` is set. `20-identity-db.sh` creates the
`openmrs_identity` schema for the Central Person Identifier, with the EMR's account as its
only writer; the liberiaemr module creates its tables. On a central database that already
exists, run their statements by hand once; initdb will not run again.

Same rules as the facility's `initdb/`: session variables, restores, and grants the
application user cannot create for itself are the legitimate uses; nothing else.
