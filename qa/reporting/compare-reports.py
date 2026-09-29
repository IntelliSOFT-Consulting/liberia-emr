#!/usr/bin/env python3
"""Runs the MOH indicator reports on a stack through reportingrest and compares them with
qa/reporting/expected-values.csv (see qa/reporting/README.md, "How the later tests compare").

  qa/reporting/compare-reports.py --url http://localhost:8080 --instance facility:careysburg
  qa/reporting/compare-reports.py --url http://localhost:8080 --instance central [--scope national]

For each sheet, period and scope in the chosen rows it:

  1. POSTs a reportRequest for the sheet's CSV design and polls it to COMPLETED (the path the
     report UI takes, contracts §4.1-4.2);
  2. reads the `indicators` data set with GET reportDataSet/{reportUuid}/indicators (§4);
  3. compares <CODE>_NUM with `numerator`, <CODE>_DEN with `denominator` (a numerator-only row
     must have no _DEN, or an empty one) and <CODE>_PCT with `value` to within 0.05.

Report and location UUIDs are looked up by name over REST, so the script holds none. It needs
the stack's fixtures loaded (load-fixtures.py) and the ETL run since. Standard library only.

Exit status: 0 when every compared row matches, 1 on any mismatch, 2 on a usage or stack error.
"""
import argparse
import base64
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))

SHEETS = OrderedDict([
    ("RMNCAH-", "MOH RMNCAH Indicators"),
    ("NUT-", "MOH Nutrition Indicators"),
    ("MAL-", "MOH Malaria Indicators"),
    ("NCD-", "MOH NCD Indicators"),
    ("EMR-OPS-", "MOH EMR Operational Indicators"),
])

TOLERANCE = 0.05


class StackError(Exception):
    pass


class Api:
    def __init__(self, url, user, password, timeout):
        self.base = url.rstrip("/") + "/openmrs/ws/rest/v1/"
        token = base64.b64encode(("%s:%s" % (user, password)).encode("utf-8")).decode("ascii")
        self.headers = {"Authorization": "Basic " + token, "Accept": "application/json"}
        self.timeout = timeout

    def call(self, path, params=None, body=None):
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = None
        headers = dict(self.headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            raise StackError("%s %s: HTTP %s %s" % ("POST" if data else "GET", path, e.code,
                                                    e.read().decode("utf-8", "replace")[:500]))
        except urllib.error.URLError as e:
            raise StackError("%s: %s" % (url, e.reason))


def sheet_of(code):
    for prefix, name in SHEETS.items():
        if code.startswith(prefix):
            return name
    raise StackError("no sheet for indicator " + code)


def column(code, part):
    return (code + "_" + part).upper().replace("-", "_")


def report_uuids(api):
    found = {}
    for rd in api.call("reportingrest/reportDefinition", {"v": "default"}).get("results", []):
        if rd.get("name") in SHEETS.values():
            found[rd["name"]] = rd["uuid"]
    missing = [n for n in SHEETS.values() if n not in found]
    if missing:
        raise StackError("reports not registered: " + ", ".join(missing))
    return found


def csv_design(api, report_uuid):
    for design in api.call("reportingrest/reportDesign", {"reportDefinitionUuid": report_uuid, "v": "full"}).get(
            "results", []):
        if "Csv" in (design.get("rendererType") or ""):
            return design["uuid"]
    raise StackError("no CSV design for report " + report_uuid)


def location_uuid(api, name, cache):
    if name == "national":
        return None
    if name not in cache:
        hits = [l for l in api.call("location", {"q": name, "v": "default"}).get("results", [])
                if l.get("display") == name or l.get("name") == name]
        if len(hits) != 1:
            raise StackError("expected one location named %r, found %d" % (name, len(hits)))
        cache[name] = hits[0]["uuid"]
    return cache[name]


def run_request(api, report_uuid, design_uuid, start, end, location, wait):
    """The asynchronous path: queue, poll, and require COMPLETED."""
    mappings = {"startDate": start, "endDate": end}
    if location:
        mappings["location"] = location
    request = api.call("reportingrest/reportRequest", body={
        "status": "REQUESTED", "priority": "NORMAL",
        "reportDefinition": {"parameterizable": {"uuid": report_uuid}, "parameterMappings": mappings},
        "renderingMode": {"argument": design_uuid}})
    deadline = time.time() + wait
    status = request.get("status")
    while status not in ("COMPLETED", "FAILED"):
        if time.time() > deadline:
            raise StackError("report request %s still %s after %ss" % (request["uuid"], status, wait))
        time.sleep(2)
        status = api.call("reportingrest/reportRequest/" + request["uuid"], {"v": "full"}).get("status")
    return request["uuid"], status


def data_set(api, report_uuid, start, end, location):
    """The synchronous path: the indicators data set as one {column: value} row."""
    params = {"startDate": start, "endDate": end}
    if location:
        params["location"] = location
    result = api.call("reportingrest/reportDataSet/%s/indicators" % report_uuid, params)
    rows = result.get("rows") if isinstance(result, dict) else None
    if not rows or len(rows) != 1:
        raise StackError("indicators data set of %s: expected one row, got %r" % (report_uuid, result))
    return {k.upper(): v for k, v in rows[0].items()}


def as_number(value):
    if value is None or value == "":
        return None
    return float(value)


def compare(row, values):
    """The mismatches of one expected row, as text; empty when it matches."""
    code = row["indicator"]
    problems = []
    num, den, pct = (values.get(column(code, p), "absent") for p in ("NUM", "DEN", "PCT"))
    if num == "absent":
        return ["%s is not in the data set" % column(code, "NUM")]
    if as_number(num) != float(row["numerator"]):
        problems.append("NUM %s, expected %s" % (num, row["numerator"]))
    if row["denominator"] == "":
        if den not in ("absent", None, ""):
            problems.append("DEN %s on a numerator-only row" % den)
    elif den == "absent" or as_number(den) != float(row["denominator"]):
        problems.append("DEN %s, expected %s" % (den, row["denominator"]))
    if row["value"] != "":
        got = None if pct == "absent" else as_number(pct)
        if got is None or abs(got - float(row["value"])) > TOLERANCE:
            problems.append("PCT %s, expected %s" % (pct, row["value"]))
    elif pct not in ("absent", None, ""):
        problems.append("PCT %s, expected none" % pct)
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="the backend's base URL, without /openmrs")
    ap.add_argument("--instance", required=True, help="expected-values.csv `instance`, e.g. facility:careysburg or central")
    ap.add_argument("--user", default=os.environ.get("QA_USER", "admin"))
    ap.add_argument("--password", default=os.environ.get("QA_PASSWORD", "Admin123"))
    ap.add_argument("--expected", default=os.path.join(HERE, "expected-values.csv"))
    ap.add_argument("--scope", action="append", help="only this scope (repeatable), e.g. national")
    ap.add_argument("--period", action="append", help="only this period (repeatable), e.g. 2026-Q1")
    ap.add_argument("--skip-request", action="store_true", help="read reportDataSet only; do not queue reportRequests")
    ap.add_argument("--wait", type=int, default=300, help="seconds to wait for a report request")
    ap.add_argument("--json", help="also write the results here")
    ap.add_argument("--dump", help="also write every data set read, all columns, here (for compare-instances.py)")
    a = ap.parse_args()

    with open(a.expected, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["instance"] == a.instance
                and (not a.scope or r["scope"] in a.scope) and (not a.period or r["period"] in a.period)]
    if not rows:
        sys.exit("no expected rows for instance %r" % a.instance)

    api = Api(a.url, a.user, a.password, timeout=120)
    try:
        reports = report_uuids(api)
        locations = {}
        runs = {}
        results = []
        for row in rows:
            key = (sheet_of(row["indicator"]), row["period_start"], row["period_end"], row["scope"])
            if key not in runs:
                report = reports[key[0]]
                location = location_uuid(api, row["scope"], locations)
                request = None
                if not a.skip_request:
                    request = run_request(api, report, csv_design(api, report), key[1], key[2], location, a.wait)
                runs[key] = (request, data_set(api, report, key[1], key[2], location))
            request, values = runs[key]
            problems = compare(row, values)
            if request and request[1] != "COMPLETED":
                problems.append("report request %s ended %s" % request)
            results.append((row, problems))
    except StackError as e:
        print("FAIL: " + str(e), file=sys.stderr)
        sys.exit(2)

    by_scope = OrderedDict()
    for row, problems in results:
        tally = by_scope.setdefault((row["scope_level"], row["scope"]), [0, 0])
        tally[1] += 1
        tally[0] += 0 if problems else 1
    print("%s: %d report runs" % (a.instance, len(runs)))
    for (level, scope), (ok, total) in by_scope.items():
        print("  %-9s %-28s %3d/%d matched" % (level, scope, ok, total))
    mismatches = [(row, problems) for row, problems in results if problems]
    for row, problems in mismatches:
        print("MISMATCH %s %s %s: %s" % (row["indicator"], row["period"], row["scope"], "; ".join(problems)))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump([{"indicator": r["indicator"], "period": r["period"], "instance": r["instance"],
                        "scope": r["scope"], "problems": p} for r, p in results], f, indent=1)
    if a.dump:
        with open(a.dump, "w", encoding="utf-8") as f:
            json.dump({"instance": a.instance,
                       "runs": [{"sheet": k[0], "start": k[1], "end": k[2], "scope": k[3], "values": v[1]}
                                for k, v in runs.items()]}, f, indent=1, sort_keys=True)
    print("%d/%d rows matched" % (len(results) - len(mismatches), len(results)))
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
