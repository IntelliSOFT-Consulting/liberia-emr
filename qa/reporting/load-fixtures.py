#!/usr/bin/env python3
"""Loads the synthetic indicator-report fixtures (qa/reporting/fixtures/*.csv) into an OpenMRS
database, for the RPT 10 checks of the indicator reports (LE-336). See qa/reporting/README.md.

  qa/reporting/load-fixtures.py lint
  qa/reporting/load-fixtures.py sql --site careysburg|barnersville|all [--out FILE]
  qa/reporting/load-fixtures.py load --site careysburg|barnersville|all --db-container NAME [--database openmrs]
  qa/reporting/load-fixtures.py prepare-central --db-container NAME [--database openmrs] [--admin-hierarchy]

`lint` needs nothing but the repository. `load` and `prepare-central` pipe SQL into
`docker exec -i NAME sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" DB'`, the same access the
qa/sync drills use. Staging and throwaway stacks only: every row it writes is synthetic and
marked (given name "Qa", family name "Rpt <key>", identifiers containing "QA").

The fixture files hold no UUID. Metadata is referenced as ${var.*} (resolved from the content
variables.properties in the build's filter order, then the patient's site package), CIEL
concepts without a variable as CIEL:<id>, and forms whose variable does not hold the runtime
identity as form:<name>@<version> (Initializer's derivation). Each fixture row's own UUID is
derived from its key, so a reload produces identical UUIDs and the expected values can be
matched by key.
"""
import argparse
import csv
import hashlib
import os
import re
import subprocess
import sys
import uuid as uuidlib
from collections import OrderedDict, defaultdict
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(HERE, "fixtures")
PKG = os.path.join(ROOT, "content-packages")

# The filter chain of content-packages/pom.xml and ADR 0010 decision 7, in order; later wins.
CHAIN = ["content-common", "content-liberia-national", "content-liberia-mch",
         "content-liberia-lab", "content-liberia-pharmacy", "content-liberia-opd-ipd"]
SITES = {"careysburg": "content-site-careysburg", "barnersville": "content-site-barnersville"}

AMPATH_FORMS_NAMESPACE = "794c4598-ab82-47ca-8d18-483a8abe6f4f"  # AmpathFormsLoader
FIXTURE_NAMESPACE = "liberiaemr-qa-reporting/LE-336/"
REGISTERED = datetime(2025, 12, 15, 8, 0, 0)  # registration drive; see README

UUID_LITERAL = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\b\d+A{8,}\b")
VAR = re.compile(r"^\$\{(var\.[A-Za-z0-9.\-_]+)\}$")


class FixtureError(Exception):
    pass


def java_uuid(seed):
    """java.util.UUID.nameUUIDFromBytes, as Initializer and validate-content.sh compute it."""
    b = bytearray(hashlib.md5(seed.encode("utf-8")).digest())
    b[6] = (b[6] & 0x0F) | 0x30
    b[8] = (b[8] & 0x3F) | 0x80
    return str(uuidlib.UUID(bytes=bytes(b)))


def fixture_uuid(kind, key):
    return java_uuid(FIXTURE_NAMESPACE + kind + "/" + key)


def read_props(path):
    out = OrderedDict()
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                out[k.strip()] = v.strip()
    return out


class Variables:
    def __init__(self):
        self.chain = OrderedDict()
        for layer in CHAIN:
            self.chain.update(read_props(os.path.join(PKG, layer, "configuration", "variables.properties")))
        self.site = {s: read_props(os.path.join(PKG, p, "configuration", "variables.properties"))
                     for s, p in SITES.items()}

    def get(self, key, site=None):
        if site and key in self.site[site]:
            return self.site[site][key]
        if key in self.chain:
            return self.chain[key]
        raise FixtureError("undeclared variable ${%s}%s" % (key, " for site " + site if site else ""))

    def resolve(self, token, site=None):
        """A ${var.*}, CIEL:<id> or form:<name>@<version> reference to a UUID."""
        m = VAR.match(token)
        if m:
            return self.get(m.group(1), site)
        if token.startswith("CIEL:"):
            num = token[5:]
            if not num.isdigit():
                raise FixtureError("bad CIEL reference " + token)
            return num + "A" * (36 - len(num))
        if token.startswith("form:"):
            name, _, version = token[5:].rpartition("@")
            if not name or not version:
                raise FixtureError("bad form reference " + token)
            return java_uuid("%s_%s_%s" % (AMPATH_FORMS_NAMESPACE, name, version))
        raise FixtureError("not a reference: " + repr(token))


def read_csv(name):
    path = os.path.join(FIXTURES, name)
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def parse_dt(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")


def q(s):
    if s is None:
        return "NULL"
    if isinstance(s, datetime):
        s = s.strftime("%Y-%m-%d %H:%M:%S")
    return "'" + str(s).replace("\\", "\\\\").replace("'", "''") + "'"


class Dataset:
    def __init__(self):
        self.forms = OrderedDict((r["key"], r) for r in read_csv("forms.csv"))
        self.patients = OrderedDict((r["key"], r) for r in read_csv("patients.csv"))
        self.encounters = OrderedDict((r["key"], r) for r in read_csv("encounters.csv"))
        self.obs = read_csv("obs.csv")
        self.diagnoses = read_csv("diagnoses.csv")
        self.orders = OrderedDict((r["key"], r) for r in read_csv("orders.csv"))
        self.check_structure()

    def check_structure(self):
        problems = []
        for name in ("forms.csv", "patients.csv", "encounters.csv", "obs.csv", "diagnoses.csv", "orders.csv"):
            with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
                for n, line in enumerate(f, 1):
                    for hit in UUID_LITERAL.findall(line):
                        problems.append("%s:%d: UUID literal %s (use ${var.*}, CIEL:<id> or form:<name>@<version>)" % (name, n, hit))
        for k, p in self.patients.items():
            if p["site"] not in SITES:
                problems.append("patient %s: unknown site %s" % (k, p["site"]))
            if p["given_name"] != "Qa" or not p["family_name"].startswith("Rpt "):
                problems.append("patient %s: synthetic marking missing (given 'Qa', family 'Rpt ...')" % k)
            if p["hrn"] not in ("one", "one+voided-old", "two"):
                problems.append("patient %s: hrn must be one, one+voided-old or two" % k)
        for k, e in self.encounters.items():
            if e["patient"] not in self.patients:
                problems.append("encounter %s: unknown patient %s" % (k, e["patient"]))
            if e["form"] and e["form"] not in self.forms:
                problems.append("encounter %s: unknown form key %s" % (k, e["form"]))
            if e["visit_voided"] and not e["voided"]:
                problems.append("encounter %s: a voided visit needs its encounters voided" % k)
        for o in self.obs:
            if o["encounter"] not in self.encounters:
                problems.append("obs: unknown encounter %s" % o["encounter"])
            if o["order"] and o["order"] not in self.orders:
                problems.append("obs: unknown order %s" % o["order"])
            enc = self.encounters.get(o["encounter"])
            if enc and enc["voided"] and not o["voided"]:
                problems.append("obs on voided encounter %s must be voided too" % o["encounter"])
        for d in self.diagnoses:
            if d["encounter"] not in self.encounters:
                problems.append("diagnosis: unknown encounter %s" % d["encounter"])
        for k, o in self.orders.items():
            if o["encounter"] not in self.encounters:
                problems.append("order %s: unknown encounter %s" % (k, o["encounter"]))
            if o["type"] not in ("drug", "test"):
                problems.append("order %s: type must be drug or test" % k)
        if problems:
            raise FixtureError("\n".join(problems))

    def site_of_encounter(self, key):
        return self.patients[self.encounters[key]["patient"]]["site"]

    def registered(self, pkey):
        """Registration time: the drive on 2025-12-15, or 07:00 on the day of an earlier first encounter."""
        firsts = [parse_dt(e["datetime"]) for e in self.encounters.values() if e["patient"] == pkey]
        first = min(firsts) if firsts else REGISTERED
        return min(REGISTERED, first.replace(hour=7, minute=0, second=0))

    def visits(self):
        """One visit per patient per calendar day: (patient, date) -> [encounter keys]."""
        out = OrderedDict()
        for k, e in self.encounters.items():
            out.setdefault((e["patient"], e["datetime"][:10]), []).append(k)
        return out


def references(ds):
    """Every metadata reference the fixtures make, as (table, token, site, label)."""
    refs = []
    for k, f in ds.forms.items():
        refs.append(("encounter_type", f["encounter_type"], None, "form %s encounter type" % k))
        if f["if_missing"] == "fail":
            refs.append(("form", f["form"], None, "form " + k))
    for k, p in ds.patients.items():
        if p["cause_of_death"]:
            refs.append(("concept", p["cause_of_death"], None, "patient %s cause of death" % k))
    for k, e in ds.encounters.items():
        site = ds.patients[e["patient"]]["site"]
        refs.append(("encounter_type", e["encounter_type"], None, "encounter " + k))
        if e["location"]:
            refs.append(("location", e["location"], site, "encounter %s location" % k))
    for o in ds.obs:
        refs.append(("concept", o["concept"], None, "obs on " + o["encounter"]))
        if is_ref(o["value"]):
            refs.append(("concept", o["value"], None, "obs answer on " + o["encounter"]))
    for d in ds.diagnoses:
        refs.append(("concept", d["concept"], None, "diagnosis on " + d["encounter"]))
    for k, o in ds.orders.items():
        refs.append(("concept", o["concept"], None, "order " + k))
        if o["drug"]:
            refs.append(("drug", o["drug"], None, "order %s drug" % k))
    for site in SITES:
        refs.append(("location", "${var.location.facility-root.uuid}", site, site + " facility root"))
    refs.append(("visit_type", "${var.visittype.outpatient.uuid}", None, "visit type"))
    refs.append(("patient_identifier_type", "${var.identifiertype.moh-health-record.uuid}", None, "MOH HRN type"))
    refs.append(("patient_identifier_type", "${var.identifiertype.national-id.uuid}", None, "National ID type"))
    return refs


def is_ref(v):
    return v.startswith("${") or v.startswith("CIEL:") or v.startswith("form:")


def lint(ds, vs):
    problems = []
    for table, token, site, label in references(ds):
        sites = [site] if site else [None]
        for s in sites:
            try:
                vs.resolve(token, s)
            except FixtureError as e:
                problems.append("%s: %s" % (label, e))
    for o in ds.obs:
        v = o["value"]
        if not is_ref(v) and not v.startswith("date:"):
            try:
                float(v)
            except ValueError:
                problems.append("obs on %s: value %r is not numeric, date:YYYY-MM-DD or a reference" % (o["encounter"], v))
    if problems:
        raise FixtureError("\n".join(problems))


def id_of(table, uuid_value):
    col = {"concept": "concept_id", "encounter_type": "encounter_type_id", "form": "form_id",
           "location": "location_id", "drug": "drug_id", "visit_type": "visit_type_id",
           "patient_identifier_type": "patient_identifier_type_id", "person": "person_id",
           "visit": "visit_id", "encounter": "encounter_id", "orders": "order_id"}[table]
    return "(SELECT %s FROM %s WHERE uuid = %s)" % (col, table, q(uuid_value))


def guard_sql(ds, vs, sites, legacy_ok=True):
    """A compound statement that stops the load if metadata is missing or the fixtures are already there."""
    checks = []
    seen = set()
    for table, token, site, label in references(ds):
        for s in ([site] if site else [None]):
            if site and site not in sites:
                continue
            u = vs.resolve(token, s)
            if (table, u) in seen:
                continue
            seen.add((table, u))
            checks.append("SELECT %s AS what FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM %s WHERE uuid = %s)"
                          % (q("%s %s (%s)" % (table, u, label)), table, q(u)))
    first = fixture_uuid("person", next(iter(k for k, p in ds.patients.items() if p["site"] in sites)))
    return """DELIMITER //
BEGIN NOT ATOMIC
  DECLARE missing TEXT DEFAULT NULL;
  SET SESSION group_concat_max_len = 1000000;
  IF EXISTS (SELECT 1 FROM person WHERE uuid = %s) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LE-336 fixtures are already loaded here; load them onto a fresh stack';
  END IF;
  SELECT GROUP_CONCAT(what SEPARATOR '\\n') INTO missing FROM (
    %s
  ) m;
  IF missing IS NOT NULL THEN
    SELECT missing AS `metadata the fixtures need but this database lacks`;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LE-336 fixtures: metadata missing (listed above)';
  END IF;
END //
DELIMITER ;
""" % (q(first), "\n    UNION ALL ".join(checks))


def legacy_forms_sql(ds, vs):
    out = []
    for k, f in ds.forms.items():
        if f["if_missing"] != "create-retired":
            continue
        name, _, version = f["form"][5:].rpartition("@")
        u = vs.resolve(f["form"])
        out.append("""INSERT INTO form (name, version, published, encounter_type, creator, date_created, retired, retired_by, date_retired, retired_reason, uuid)
SELECT %s, %s, 1, %s, @creator, '2025-06-01 00:00:00', 1, @creator, '2025-11-01 00:00:00', 'LE-336 fixture: superseded form version', %s
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM form WHERE uuid = %s);"""
                   % (q(name), q(version), id_of("encounter_type", vs.resolve(f["encounter_type"])), q(u), q(u)))
    return "\n".join(out)


def data_sql(ds, vs, sites):
    out = []
    w = out.append
    visits = ds.visits()
    patients = [k for k, p in ds.patients.items() if p["site"] in sites]
    pset = set(patients)
    national_type = id_of("patient_identifier_type", vs.resolve("${var.identifiertype.national-id.uuid}"))
    hrn_type = id_of("patient_identifier_type", vs.resolve("${var.identifiertype.moh-health-record.uuid}"))
    seq = defaultdict(int)

    for k in patients:
        p = ds.patients[k]
        site = p["site"]
        seq[site] += 1
        root = id_of("location", vs.get("var.location.facility-root.uuid", site))
        reg = ds.registered(k)
        pu = fixture_uuid("person", k)
        person = id_of("person", pu)
        cause = id_of("concept", vs.resolve(p["cause_of_death"])) if p["cause_of_death"] else "NULL"
        w("-- patient %s: %s" % (k, p["purpose"]))
        w("INSERT INTO person (gender, birthdate, birthdate_estimated, dead, death_date, cause_of_death, deathdate_estimated, creator, date_created, voided, uuid) "
          "VALUES (%s, %s, 0, %d, %s, %s, 0, @creator, %s, 0, %s);"
          % (q(p["gender"]), q(p["birthdate"]), 1 if p["dead"] else 0, q(p["death_date"] or None), cause, q(reg), q(pu)))
        w("INSERT INTO person_name (preferred, person_id, given_name, family_name, creator, date_created, voided, uuid) "
          "VALUES (1, %s, %s, %s, @creator, %s, 0, %s);"
          % (person, q(p["given_name"]), q(p["family_name"]), q(reg), q(fixture_uuid("person_name", k))))
        w("INSERT INTO patient (patient_id, creator, date_created, voided, allergy_status) VALUES (%s, @creator, %s, 0, 'Unknown');"
          % (person, q(reg)))
        prefix = vs.get("var.site.moh-hrn-prefix", site)
        idents = [(hrn_type, "%s-QA%04d" % (prefix, seq[site]), 1, 0, "hrn")]
        if p["hrn"] == "one+voided-old":
            idents.append((hrn_type, "%s-QAOLD%04d" % (prefix, seq[site]), 0, 1, "hrn-old"))
        if p["hrn"] == "two":
            idents.append((hrn_type, "%s-QA%04dB" % (prefix, seq[site]), 0, 0, "hrn-second"))
        if p["national_id"]:
            idents.append((national_type, p["national_id"], 0, 0, "national-id"))
        for type_id, value, preferred, voided, tag in idents:
            w("INSERT INTO patient_identifier (patient_id, identifier, identifier_type, preferred, location_id, creator, date_created, voided, voided_by, date_voided, void_reason, uuid) "
              "VALUES (%s, %s, %s, %d, %s, @creator, %s, %d, %s, %s, %s, %s);"
              % (person, q(value), type_id, preferred, root, q(reg), voided,
                 "@creator" if voided else "NULL", q(reg + timedelta(days=30)) if voided else "NULL",
                 q("LE-336 fixture: identifier re-issued") if voided else "NULL", q(fixture_uuid("identifier", k + "/" + tag))))

    for (pk, day), encs in visits.items():
        if pk not in pset:
            continue
        site = ds.patients[pk]["site"]
        root = id_of("location", vs.get("var.location.facility-root.uuid", site))
        started = min(parse_dt(ds.encounters[e]["datetime"]) for e in encs)
        voided = any(ds.encounters[e]["visit_voided"] for e in encs)
        vu = fixture_uuid("visit", "%s/%s" % (pk, day))
        w("INSERT INTO visit (patient_id, visit_type_id, date_started, date_stopped, location_id, creator, date_created, voided, voided_by, date_voided, void_reason, uuid) "
          "VALUES (%s, %s, %s, %s, %s, @creator, %s, %d, %s, %s, %s, %s);"
          % (id_of("person", fixture_uuid("person", pk)), id_of("visit_type", vs.resolve("${var.visittype.outpatient.uuid}")),
             q(started), q(day + " 23:59:59"), root, q(started), 1 if voided else 0,
             "@creator" if voided else "NULL", q(started + timedelta(hours=2)) if voided else "NULL",
             q("LE-336 fixture: visit entered on the wrong patient") if voided else "NULL", q(vu)))

    entered = {}
    for k, e in ds.encounters.items():
        if e["patient"] not in pset:
            continue
        site = ds.patients[e["patient"]]["site"]
        when = parse_dt(e["datetime"])
        created = parse_dt(e["entered"]) if e["entered"] else when
        entered[k] = created
        form = id_of("form", vs.resolve(ds.forms[e["form"]]["form"])) if e["form"] else "NULL"
        loc = id_of("location", vs.resolve(e["location"], site)) if e["location"] else "NULL"
        voided = bool(e["voided"])
        w("INSERT INTO encounter (encounter_type, patient_id, location_id, form_id, encounter_datetime, creator, date_created, voided, voided_by, date_voided, void_reason, visit_id, uuid) "
          "VALUES (%s, %s, %s, %s, %s, @creator, %s, %d, %s, %s, %s, %s, %s);"
          % (id_of("encounter_type", vs.resolve(e["encounter_type"])), id_of("person", fixture_uuid("person", e["patient"])),
             loc, form, q(when), q(created), 1 if voided else 0, "@creator" if voided else "NULL",
             q(created + timedelta(hours=1)) if voided else "NULL", q("LE-336 fixture: entered in error") if voided else "NULL",
             id_of("visit", fixture_uuid("visit", "%s/%s" % (e["patient"], e["datetime"][:10]))), q(fixture_uuid("encounter", k))))

    for k, o in ds.orders.items():
        e = ds.encounters[o["encounter"]]
        if e["patient"] not in pset:
            continue
        when = parse_dt(e["datetime"])
        ou = fixture_uuid("order", k)
        voided = bool(o["voided"])
        order_type = ("(SELECT order_type_id FROM order_type WHERE java_class_name = 'org.openmrs.DrugOrder' ORDER BY order_type_id LIMIT 1)"
                      if o["type"] == "drug" else
                      "(SELECT order_type_id FROM order_type WHERE java_class_name = 'org.openmrs.TestOrder' ORDER BY order_type_id LIMIT 1)")
        w("INSERT INTO orders (order_type_id, concept_id, orderer, encounter_id, date_activated, creator, date_created, voided, voided_by, date_voided, void_reason, patient_id, uuid, urgency, order_number, order_action, care_setting, fulfiller_status) "
          "VALUES (%s, %s, @orderer, %s, %s, @creator, %s, %d, %s, %s, %s, %s, %s, 'ROUTINE', %s, 'NEW', @care_setting, %s);"
          % (order_type, id_of("concept", vs.resolve(o["concept"])), id_of("encounter", fixture_uuid("encounter", o["encounter"])),
             q(when), q(when), 1 if voided else 0, "@creator" if voided else "NULL", q(when + timedelta(hours=1)) if voided else "NULL",
             q("LE-336 fixture: entered in error") if voided else "NULL", id_of("person", fixture_uuid("person", e["patient"])), q(ou),
             q("QA-RPT-" + k), "NULL" if o["type"] == "drug" else "'COMPLETED'"))
        if o["type"] == "drug":
            w("INSERT INTO drug_order (order_id, drug_inventory_id, dosing_type, dosing_instructions, quantity, num_refills, as_needed, dispense_as_written) "
              "VALUES (%s, %s, 'org.openmrs.FreeTextDosingInstructions', 'LE-336 fixture', 1, 0, 0, 0);"
              % (id_of("orders", ou), id_of("drug", vs.resolve(o["drug"]))))
        else:
            w("INSERT INTO test_order (order_id) VALUES (%s);" % id_of("orders", ou))

    counters = defaultdict(int)
    for o in ds.obs:
        e = ds.encounters[o["encounter"]]
        if e["patient"] not in pset:
            continue
        site = ds.patients[e["patient"]]["site"]
        counters[o["encounter"]] += 1
        when = parse_dt(o["obs_datetime"]) if o["obs_datetime"] else parse_dt(e["datetime"])
        created = max(when, entered[o["encounter"]])
        v = o["value"]
        coded = numeric = dt = "NULL"
        if is_ref(v):
            coded = id_of("concept", vs.resolve(v))
        elif v.startswith("date:"):
            dt = q(v[5:] + " 00:00:00")
        else:
            numeric = v
        loc = id_of("location", vs.resolve(e["location"], site)) if e["location"] else "NULL"
        voided = bool(o["voided"])
        w("INSERT INTO obs (person_id, concept_id, encounter_id, order_id, obs_datetime, location_id, value_coded, value_numeric, value_datetime, creator, date_created, voided, voided_by, date_voided, void_reason, uuid, status) "
          "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, @creator, %s, %d, %s, %s, %s, %s, 'FINAL');"
          % (id_of("person", fixture_uuid("person", e["patient"])), id_of("concept", vs.resolve(o["concept"])),
             id_of("encounter", fixture_uuid("encounter", o["encounter"])),
             id_of("orders", fixture_uuid("order", o["order"])) if o["order"] else "NULL",
             q(when), loc, coded, numeric, dt, q(created), 1 if voided else 0, "@creator" if voided else "NULL",
             q(created + timedelta(minutes=5)) if voided else "NULL", q("LE-336 fixture: entered in error") if voided else "NULL",
             q(fixture_uuid("obs", "%s/%d" % (o["encounter"], counters[o["encounter"]])))))

    counters.clear()
    for d in ds.diagnoses:
        e = ds.encounters[d["encounter"]]
        if e["patient"] not in pset:
            continue
        counters[d["encounter"]] += 1
        created = entered[d["encounter"]]
        voided = bool(d["voided"])
        w("INSERT INTO encounter_diagnosis (diagnosis_coded, encounter_id, patient_id, certainty, dx_rank, uuid, creator, date_created, voided, voided_by, date_voided, void_reason) "
          "VALUES (%s, %s, %s, %s, %d, %s, @creator, %s, %d, %s, %s, %s);"
          % (id_of("concept", vs.resolve(d["concept"])), id_of("encounter", fixture_uuid("encounter", d["encounter"])),
             id_of("person", fixture_uuid("person", e["patient"])), q(d["certainty"]), counters[d["encounter"]],
             q(fixture_uuid("diagnosis", "%s/%d" % (d["encounter"], counters[d["encounter"]]))), q(created),
             1 if voided else 0, "@creator" if voided else "NULL", q(created + timedelta(minutes=5)) if voided else "NULL",
             q("LE-336 fixture: entered in error") if voided else "NULL"))
    return "\n".join(out)


SESSION = """SET @creator := (SELECT user_id FROM users WHERE system_id = 'admin');
SET @orderer := COALESCE(
  (SELECT provider_id FROM provider WHERE retired = 0 AND person_id = (SELECT person_id FROM users WHERE system_id = 'admin') ORDER BY provider_id LIMIT 1),
  (SELECT provider_id FROM provider WHERE retired = 0 ORDER BY provider_id LIMIT 1));
SET @care_setting := (SELECT care_setting_id FROM care_setting WHERE care_setting_type = 'OUTPATIENT' ORDER BY care_setting_id LIMIT 1);
"""


def load_sql(ds, vs, sites):
    return "\n".join([
        "-- LE-336 indicator-report fixtures (synthetic, no PHI). Generated by qa/reporting/load-fixtures.py; do not commit.",
        "-- Sites: " + ", ".join(sites),
        SESSION,
        guard_sql(ds, vs, sites),
        "START TRANSACTION;",
        legacy_forms_sql(ds, vs),
        data_sql(ds, vs, sites),
        "COMMIT;",
        "SELECT COUNT(*) AS `LE-336 fixture patients present` FROM person WHERE uuid IN (%s);"
        % ", ".join(q(fixture_uuid("person", k)) for k, p in ds.patients.items() if p["site"] in sites),
        "",
    ])


def site_locations(vs, site):
    """The site package's own location rows, resolved: (uuid, name, description, parent name, tags, address)."""
    path = os.path.join(PKG, SITES[site], "configuration", "backend_configuration", "locations")
    rows = []
    for fn in sorted(os.listdir(path)):
        if not fn.endswith(".csv"):
            continue
        with open(os.path.join(path, fn), encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                tags = [h.split("|", 1)[1] for h, v in r.items() if h and h.startswith("Tag|") and (v or "").strip().upper() == "TRUE"]
                rows.append((vs.resolve(r["Uuid"], site), r["Name"], r.get("Description") or None, r.get("Parent") or None, tags,
                             r.get("City/village") or None, r.get("State/province") or None, r.get("Country") or None))
    return rows


def prepare_central_sql(ds, vs, admin_hierarchy):
    out = [SESSION, "START TRANSACTION;"]
    w = out.append
    for site in SITES:
        rows = site_locations(vs, site)
        by_name = {r[1]: r[0] for r in rows}
        for u, name, desc, parent, tags, city, state, country in rows:
            w("INSERT INTO location (name, description, city_village, state_province, country, creator, date_created, retired, uuid) "
              "SELECT %s, %s, %s, %s, %s, @creator, NOW(), 0, %s FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM location WHERE uuid = %s);"
              % (q(name), q(desc), q(city), q(state), q(country), q(u), q(u)))
        for u, name, desc, parent, tags, city, state, country in rows:
            if parent:
                w("UPDATE location SET parent_location = %s WHERE uuid = %s AND parent_location IS NULL;"
                  % (id_of("location", by_name[parent]), q(u)))
            for t in tags:
                w("INSERT INTO location_tag_map (location_id, location_tag_id) SELECT l.location_id, t.location_tag_id FROM location l, location_tag t "
                  "WHERE l.uuid = %s AND t.name = %s AND t.retired = 0 AND NOT EXISTS (SELECT 1 FROM location_tag_map m WHERE m.location_id = l.location_id AND m.location_tag_id = t.location_tag_id);"
                  % (q(u), q(t)))
        if admin_hierarchy:
            county = vs.get("var.location.county.name", site)
            district = vs.get("var.location.district.name", site)
            cu = fixture_uuid("admin-location", "county/" + county)
            du = fixture_uuid("admin-location", "district/" + county + "/" + district)
            for u, name, desc in ((cu, county, "County (LE-336 test scaffold until the MFL sync provides it)"),
                                  (du, district, "Health district (LE-336 test scaffold until the MFL sync provides it)")):
                w("INSERT INTO location (name, description, creator, date_created, retired, uuid) SELECT %s, %s, @creator, NOW(), 0, %s "
                  "FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM location WHERE uuid = %s);" % (q(name), q(desc), q(u), q(u)))
            w("UPDATE location SET parent_location = %s WHERE uuid = %s AND parent_location IS NULL;" % (id_of("location", cu), q(du)))
            w("UPDATE location SET parent_location = %s WHERE uuid = %s AND parent_location IS NULL;"
              % (id_of("location", du), q(vs.get("var.location.facility-root.uuid", site))))
    w(legacy_forms_sql(ds, vs))
    w("COMMIT;")
    return "\n".join(out) + "\n"


def run_sql(container, database, sql):
    cmd = ["docker", "exec", "-i", container, "sh", "-c", 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$1"', "sh", database]
    r = subprocess.run(cmd, input=sql.encode("utf-8"))
    if r.returncode != 0:
        sys.exit("FAIL: the database refused the fixture SQL (see above); nothing was committed")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("lint", help="check the fixture files offline")
    s = sub.add_parser("sql", help="print the load SQL")
    s.add_argument("--site", required=True, choices=list(SITES) + ["all"])
    s.add_argument("--out")
    l = sub.add_parser("load", help="load into a running stack's database")
    l.add_argument("--site", required=True, choices=list(SITES) + ["all"])
    l.add_argument("--db-container", required=True)
    l.add_argument("--database", default="openmrs")
    c = sub.add_parser("prepare-central", help="give central both sites' locations and the legacy form rows")
    c.add_argument("--db-container", required=True)
    c.add_argument("--database", default="openmrs")
    c.add_argument("--admin-hierarchy", action="store_true",
                   help="also create County/District parents from the site variables (until the MFL sync provides them)")
    c.add_argument("--print", action="store_true", help="print the SQL instead of running it")
    a = ap.parse_args()

    try:
        ds = Dataset()
        vs = Variables()
        lint(ds, vs)
        if a.cmd == "lint":
            print("ok: %d patients, %d encounters, %d obs, %d diagnoses, %d orders; no UUID literal; every reference resolves"
                  % (len(ds.patients), len(ds.encounters), len(ds.obs), len(ds.diagnoses), len(ds.orders)))
            return
        if a.cmd == "prepare-central":
            sql = prepare_central_sql(ds, vs, a.admin_hierarchy)
            if a.print:
                sys.stdout.write(sql)
            else:
                run_sql(a.db_container, a.database, sql)
                print("ok: central holds both sites' locations and the legacy form rows")
            return
        sites = list(SITES) if a.site == "all" else [a.site]
        sql = load_sql(ds, vs, sites)
        if a.cmd == "sql":
            if a.out:
                with open(a.out, "w", encoding="utf-8") as f:
                    f.write(sql)
            else:
                sys.stdout.write(sql)
            return
        run_sql(a.db_container, a.database, sql)
        print("ok: LE-336 fixtures loaded for " + ", ".join(sites))
    except FixtureError as e:
        sys.exit("FAIL:\n" + str(e))


if __name__ == "__main__":
    main()
