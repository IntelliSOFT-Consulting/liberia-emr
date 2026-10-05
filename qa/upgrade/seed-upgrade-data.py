#!/usr/bin/env python3
"""Synthetic patient data for the upgrade test (run-upgrade.sh), written over REST.

Gives the database being upgraded the data shapes an upgrade can break (README.md):
observations on every Numeric, Coded, Text, Boolean and Date concept the release's content
defines, an encounter of every encounter type, and an enrolment in every programme with a
state in each of its workflows. Every patient is fabricated; nothing here may ever come from
a real system.

    seed-upgrade-data.py --base-url http://backend:8080/openmrs --concepts concept-uuids.txt

run-upgrade.sh runs it in a throwaway container on the stack's network. Writes that the
server rejects (a concept the REST API will not take a value for, say) are counted and
reported, not fatal: the test needs coverage, not every row. It fails only when nothing at
all could be written.
"""
import argparse
import base64
import datetime
import json
import sys
import urllib.error
import urllib.request

DATATYPE_VALUES = {
    "Numeric": None,  # from the concept's own range, below
    "Coded": None,  # its first answer
    "Text": "upgrade test",
    "Boolean": True,
    "Date": datetime.date(2026, 1, 15).isoformat(),
}


class Api:
    def __init__(self, base, user, password):
        self.base = base.rstrip("/") + "/ws/rest/v1/"
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self.headers = {"Authorization": "Basic " + token, "Content-Type": "application/json"}

    def call(self, path, body=None):
        req = urllib.request.Request(self.base + path, headers=self.headers,
                                     data=None if body is None else json.dumps(body).encode(),
                                     method="GET" if body is None else "POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"{e.code} on {path}: {detail}") from None

    def results(self, path):
        out, start = [], 0
        while True:
            sep = "&" if "?" in path else "?"
            page = self.call(f"{path}{sep}limit=100&startIndex={start}").get("results", [])
            out += page
            if len(page) < 100:
                return out
            start += 100


def numeric_value(c):
    for key in ("lowNormal", "lowAbsolute", "lowCritical"):
        if c.get(key) is not None:
            return c[key]
    hi = c.get("hiAbsolute")
    return 1 if hi is None or hi >= 1 else hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="Admin123")
    ap.add_argument("--concepts", required=True, help="file of concept uuids, one per line")
    ap.add_argument("--patients", type=int, default=3)
    a = ap.parse_args()
    api = Api(a.base_url, a.user, a.password)
    stats = {"patients": 0, "visits": 0, "encounters": 0, "obs": 0, "enrolments": 0,
             "states": 0, "skipped": 0}
    rejected = []
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")

    location = api.results("location?tag=Login%20Location&v=custom:(uuid)")[0]["uuid"]
    id_types = {t["name"]: t["uuid"] for t in api.results("patientidentifiertype?v=custom:(uuid,name,required)")}
    required = [t["name"] for t in api.results("patientidentifiertype?v=custom:(name,required)") if t["required"]]
    sources = api.results("idgen/identifiersource?v=custom:(uuid,name,identifierType:(uuid))")

    def new_identifier(type_uuid):
        src = next((s for s in sources if (s.get("identifierType") or {}).get("uuid") == type_uuid), None)
        if src is None:
            raise RuntimeError(f"no identifier source generates type {type_uuid}")
        return api.call(f"idgen/identifiersource/{src['uuid']}/identifier", {})["identifier"]

    patients = []
    for i in range(a.patients):
        types = required or ["OpenMRS ID"]
        ids = [{"identifier": new_identifier(id_types[n]), "identifierType": id_types[n],
                "location": location, "preferred": k == 0} for k, n in enumerate(types)]
        p = api.call("patient", {"person": {"names": [{"givenName": f"Upgrade{i}", "familyName": "Synthetic"}],
                                            "gender": "F", "birthdate": "1995-03-01"},
                                 "identifiers": ids})
        patients.append(p["uuid"])
        stats["patients"] += 1

    session = api.call("session?v=custom:(user:(uuid))")
    provider = api.results(f"provider?user={session['user']['uuid']}&v=custom:(uuid)")
    role = api.results("encounterrole?v=custom:(uuid)")[0]["uuid"]
    visit_type = api.results("visittype?v=custom:(uuid)")[0]["uuid"]
    visit = api.call("visit", {"patient": patients[0], "visitType": visit_type,
                               "startDatetime": now, "location": location})["uuid"]
    stats["visits"] += 1

    encounters = []
    for et in api.results("encountertype?v=custom:(uuid,display)"):
        body = {"patient": patients[0], "visit": visit, "encounterType": et["uuid"],
                "encounterDatetime": now, "location": location}
        if provider:
            body["encounterProviders"] = [{"provider": provider[0]["uuid"], "encounterRole": role}]
        try:
            encounters.append(api.call("encounter", body)["uuid"])
            stats["encounters"] += 1
        except RuntimeError as e:
            rejected.append(f"encounter type {et['display']}: {e}")
    if not encounters:
        sys.exit("no encounter could be created; nothing to hang observations on")

    with open(a.concepts) as f:
        concept_uuids = [line.strip() for line in f if line.strip()]
    for n, uuid in enumerate(concept_uuids):
        try:
            # v=full: a custom view naming the numeric range fields fails on a non-numeric concept
            c = api.call(f"concept/{uuid}?v=full")
        except RuntimeError:
            stats["skipped"] += 1  # not in this database: a later content row, or never loaded
            continue
        dt = c["datatype"]["display"]
        if c.get("retired") or c.get("set") or dt not in DATATYPE_VALUES:
            stats["skipped"] += 1
            continue
        if dt == "Numeric":
            value = numeric_value(c)
        elif dt == "Coded":
            if not c.get("answers"):
                stats["skipped"] += 1
                continue
            value = c["answers"][0]["uuid"]
        else:
            value = DATATYPE_VALUES[dt]
        try:
            # The obs person must be the encounter's patient.
            api.call("obs", {"person": patients[0], "concept": uuid, "value": value,
                             "obsDatetime": now, "encounter": encounters[n % len(encounters)]})
            stats["obs"] += 1
        except RuntimeError as e:
            rejected.append(f"obs on {c['display']} ({dt}): {e}")

    for prog in api.results("program?v=full"):
        states = []
        for wf in prog.get("allWorkflows") or []:
            usable = [s for s in wf.get("states") or [] if not s.get("retired")]
            first = next((s for s in usable if s.get("initial")), usable[0] if usable else None)
            if not wf.get("retired") and first:
                states.append({"state": first["uuid"], "startDate": now})
        try:
            api.call("programenrollment", {"patient": patients[-1], "program": prog["uuid"],
                                           "dateEnrolled": now, "location": location, "states": states})
            stats["enrolments"] += 1
            stats["states"] += len(states)
        except RuntimeError as e:
            rejected.append(f"enrolment in {prog['display']}: {e}")

    print("seeded: " + ", ".join(f"{k} {v}" for k, v in stats.items()))
    if rejected:
        print(f"{len(rejected)} writes rejected (reported, not fatal):")
        for r in rejected[:25]:
            print("  " + r)
    if stats["obs"] == 0:
        sys.exit("no observation could be written; the upgrade test would prove nothing")


if __name__ == "__main__":
    main()
