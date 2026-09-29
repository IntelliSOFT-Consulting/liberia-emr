#!/usr/bin/env python3
"""Checks that a facility's indicator reports equal central's reports scoped to that facility
(ADR 0010 decision 5, the consistency rule), column for column, from two dumps written by
compare-reports.py --dump (see qa/reporting/README.md and docs/runbooks/reporting-etl.md).

  qa/reporting/compare-instances.py FACILITY_DUMP CENTRAL_DUMP [--exclude EMR-OPS-007 ...]

The facility dump holds the facility instance's runs; the central dump must include runs scoped
to that facility (compare-reports.py --instance central runs every scope in expected-values.csv,
the facility's included). Every column of the `indicators` data set is compared, not only the
NUM, DEN and PCT columns expected-values.csv holds: disaggregations too.

EMR-OPS-007 and EMR-OPS-015 are excluded by default: the matrix gives central its own
definition of both (CPI-based duplicates and identifier consistency), so they are expected to
differ. None of the 21 Feasible-now indicators depends on when the report runs, so no other
exclusion is needed; pass --exclude for one that does.

The comparison is meaningful only when both instances hold the same rows: central loaded from
the same fixtures (or fully synced), and both ETLs run since.

Exit status: 0 when every column matches, 1 on any difference, 2 on a usage error.
Standard library only.
"""
import argparse
import json
import sys

DEFAULT_EXCLUDE = ["EMR-OPS-007", "EMR-OPS-015"]


def load(path):
    with open(path, encoding="utf-8") as f:
        dump = json.load(f)
    return dump["instance"], {(r["sheet"], r["start"], r["end"], r["scope"]): r["values"] for r in dump["runs"]}


def excluded(column, prefixes):
    return any(column.startswith(p) for p in prefixes)


def same(a, b):
    if a in (None, "") or b in (None, ""):
        return (a in (None, "")) == (b in (None, ""))
    try:
        return abs(float(a) - float(b)) < 0.0001
    except (TypeError, ValueError):
        return a == b


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("facility_dump")
    ap.add_argument("central_dump")
    ap.add_argument("--exclude", action="append", help="an indicator code whose columns are not compared (repeatable); "
                                                        "replaces the default " + ", ".join(DEFAULT_EXCLUDE))
    a = ap.parse_args()

    f_instance, facility = load(a.facility_dump)
    c_instance, central = load(a.central_dump)
    if not f_instance.startswith("facility:") or c_instance != "central":
        sys.exit("expected a facility dump, then a central dump; got %s and %s" % (f_instance, c_instance))
    prefixes = [c.upper().replace("-", "_") + "_" for c in (a.exclude or DEFAULT_EXCLUDE)]

    compared = skipped = 0
    differences = []
    for key, f_values in sorted(facility.items()):
        c_values = central.get(key)
        if c_values is None:
            differences.append("%s %s..%s %s: central has no run for this facility scope" % key)
            continue
        for column in sorted(set(f_values) | set(c_values)):
            if excluded(column, prefixes):
                skipped += 1
                continue
            compared += 1
            fv, cv = f_values.get(column, "absent"), c_values.get(column, "absent")
            if not same(fv, cv):
                differences.append("%s %s..%s %s: %s is %s at the facility, %s at central" % (key + (column, fv, cv)))
    print("%s against central: %d runs, %d cells compared, %d cells of %s skipped"
          % (f_instance, len(facility), compared, skipped, ", ".join(a.exclude or DEFAULT_EXCLUDE)))
    for d in differences:
        print("DIFFERENT " + d)
    print("%d differences" % len(differences))
    sys.exit(1 if differences else 0)


if __name__ == "__main__":
    main()
