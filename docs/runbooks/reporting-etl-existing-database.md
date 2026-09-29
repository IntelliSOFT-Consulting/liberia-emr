# Runbook: turn on the reporting ETL on an existing database

The reporting ETL (ADR 0010) needs a database user and schema, which an initdb script creates:
facility `initdb/20-etl-db-user.sh`, central `initdb/30-etl-db-user.sh`. initdb runs only on the
first boot of an empty data volume. On a database created **before** the ETL release, or created
without `ETL_DB_PASSWORD`, the ETL module only logs that it could not deploy, and reports stay
empty. This runbook creates the user and schema on such a database.

It reruns the stack's own initdb script instead of typing the statements by hand. The script is
idempotent (`CREATE … IF NOT EXISTS`, then `GRANT`), and it runs with `sql_log_bin = 0`, so the
ETL password never reaches a facility's binlog. At central it also grants the ETL user
`SELECT` on `openmrs_identity`, which `mamba_dim_person_cpi` needs to count each person once.
Leaving that grant out breaks no ETL run, but it makes central's person counts silently wrong.

**Rehearsal status:** not yet run on a live facility or central. Rehearse it first on staging.

Commands assume the repository is checked out on the host, at the release being deployed.
`stack` stands for `docker compose -f distribution/compose/<facility|central>/docker-compose.yml
--env-file <env file>`. At a facility that syncs, also add `--profile sync`.

## 1. Set the ETL credentials

In the env file, set `ETL_DB_PASSWORD` to a new random value. `ETL_DB_USER` defaults to
`mambaetl`; set it only to use another name. Keep the file's permissions as they are.

## 2. Recreate the database and backend containers

```bash
stack up -d db backend
```

This applies the server flags the ETL needs (`--event-scheduler`, `--performance-schema` and its
consumer; at a facility also `--log-bin-trust-function-creators` and
`--binlog-ignore-db=liberiaemr_etl`), and puts the ETL variables in both containers. The data
volume is kept. The backend fails to deploy the ETL until step 3; that is expected.

## 3. Run the initdb script once

Facility:

```bash
stack exec -T db sh /docker-entrypoint-initdb.d/20-etl-db-user.sh
```

Central:

```bash
stack exec -T db sh /docker-entrypoint-initdb.d/30-etl-db-user.sh
```

The script prints `created the reporting ETL user …` and `granted '<OpenMRS user>' read access
to 'liberiaemr_etl'`. If it prints `ETL_DB_PASSWORD unset`, the container did not get the
variable: check step 1 and repeat step 2.

## 4. Check

The grants, without printing any password:

```bash
stack exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" \
  -e "SHOW GRANTS FOR \`${ETL_DB_USER:-mambaetl}\`@\`%\`"'
```

Expect `ALL` on `liberiaemr_etl`, `SELECT` on the OpenMRS schema and on
`performance_schema.events_statements_current`, and at central `SELECT` on `openmrs_identity`.

At a facility, confirm that the binlog holds no statement for the ETL user:

```bash
stack exec -T db sh -c 'cd /var/lib/mysql && mariadb-binlog -vv binlog.[0-9]* \
  | grep -i "IDENTIFIED BY" | grep -ci "${ETL_DB_USER:-mambaetl}"'
```

Expect `0`. Anything else means the ETL password is in the binlog: set a new one in the env
file, recreate `db` and `backend` (step 2), then run
`ALTER USER` for it with `SET SESSION sql_log_bin = 0` and purge the binlogs that hold the old
one. Other accounts' statements, from first boots before LE-361, are handled by
[binlog-credentials.md](binlog-credentials.md).

## 5. Restart the backend

```bash
stack restart backend
```

The ETL deploys on start. The first run is a full one, and a report shows data once it
completes; the report page shows the last run's status.
