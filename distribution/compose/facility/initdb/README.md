# initdb

Mounted read-only at `/docker-entrypoint-initdb.d` in the `db` service. MariaDB runs
everything here **once**, on the first boot of an empty data volume, and never again — so
this is not a migration mechanism. OpenMRS owns the schema through Liquibase, and metadata
belongs in a content package.

Legitimate uses are the few things that have to be true before OpenMRS first connects:
session variables, a restored backup when standing a facility back up, a grant the
application user cannot create for itself.

The one committed script, `10-sync-db-users.sh`, creates the sync layer's database
principals (a Debezium replication user and the sender's management schema) and does
nothing unless their passwords are set in the environment. Compose bind-mounts this
directory by relative path, and
Docker creates a missing bind source as a root-owned directory — so an absent `initdb/`
does not fail the stack, it silently appears in a working tree owned by root.
