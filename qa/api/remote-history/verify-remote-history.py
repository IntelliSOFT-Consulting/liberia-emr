#!/usr/bin/env python3
"""API contract test for central's remote history endpoint (LE-382, ADR 0013).

  qa/api/remote-history/verify-remote-history.py --base-url https://central.example \
      --user USER --password PASS --patient-uuid UUID \
      [--requesting-facility LOCATION_UUID] [--allow-host HOST]

Runs against a CENTRAL instance (LIBERIAEMR_INSTANCE_ROLE=central) as an account holding View
Remote History. It only reads. It refuses any host but localhost unless you pass --allow-host.

Checks:
  - the response holds only the ADR 0013 resource types, and nothing outside them;
  - Observations appear only as the tagged ANC contact summary; encounters carry no observations;
  - every bundle is a FHIR collection Bundle, and every source names its facility;
  - with --requesting-facility, no source is that facility;
  - an unknown patient is 200 with an empty list, not 404; a malformed UUID is 400.

Every check prints PASS or FAIL and the script carries on, exiting non-zero if any failed.
"""
import argparse
import base64
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

# ADR 0013 §4 / LE-382: everything the endpoint may return. Keep in step with
# RemoteHistoryAssembler.RESOURCE_TYPES.
ALLOWED = {"AllergyIntolerance", "Condition", "MedicationRequest", "Immunization", "EpisodeOfCare",
           "Observation", "Encounter"}
ANC_SUMMARY_TAG = "anc-contact-summary"

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        failures += 1


def get(args, path):
    url = args.base_url.rstrip("/") + "/openmrs/ws/rest/v1/liberiaemr/remotehistory/" + path
    token = base64.b64encode(f"{args.user}:{args.password}".encode()).decode()
    request = urllib.request.Request(url, headers={"Authorization": "Basic " + token, "Accept": "application/json"})
    context = ssl.create_default_context()
    if urllib.parse.urlparse(url).hostname in ("localhost", "127.0.0.1"):
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(request, context=context, timeout=60) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, json.loads(body) if body else {}


def resources(body):
    for source in body.get("sources", []):
        for entry in source.get("bundle", {}).get("entry", []):
            yield source, entry.get("resource", {})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="https://localhost")
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--patient-uuid", required=True)
    parser.add_argument("--requesting-facility")
    parser.add_argument("--allow-host", action="append", default=[])
    args = parser.parse_args()

    host = urllib.parse.urlparse(args.base_url).hostname
    if host not in ("localhost", "127.0.0.1") and host not in args.allow_host:
        sys.exit(f"refusing to run against {host}; pass --allow-host {host}")

    path = args.patient_uuid
    if args.requesting_facility:
        path += "?requestingFacility=" + urllib.parse.quote(args.requesting_facility)
    status, body = get(args, path)
    check("history answers 200", status == 200, f"got {status}: {body}")
    check("sources is a list", isinstance(body.get("sources"), list))
    check("patientUuid echoes the request", body.get("patientUuid") == args.patient_uuid)

    seen = set()
    for source, resource in resources(body):
        kind = resource.get("resourceType")
        seen.add(kind)
        check(f"{kind} is in the ADR 0013 scope", kind in ALLOWED)
        if kind == "Observation":
            tags = [t.get("code") for t in resource.get("meta", {}).get("tag", [])]
            check("Observation is the tagged ANC contact summary", ANC_SUMMARY_TAG in tags, str(tags))
        if kind == "Encounter":
            check("Encounter index carries no observations", "contained" not in resource and "obs" not in resource)
    for source in body.get("sources", []):
        bundle = source.get("bundle", {})
        check("bundle is a FHIR collection", bundle.get("resourceType") == "Bundle" and bundle.get("type") == "collection")
        check("source names its facility", "sourceFacilityUuid" in source and "sourceFacilityName" in source)
        if args.requesting_facility:
            check("requesting facility's own records are left out",
                  source.get("sourceFacilityUuid") != args.requesting_facility)
    print("resource types returned: " + (", ".join(sorted(seen)) or "none"))

    status, body = get(args, str(uuid.uuid4()))
    check("unknown patient is 200, not 404", status == 200, f"got {status}")
    check("unknown patient has no sources", body.get("sources") == [], str(body))

    status, _ = get(args, "not-a-uuid")
    check("malformed UUID is 400", status == 400, f"got {status}")

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
