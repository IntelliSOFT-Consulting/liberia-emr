#!/usr/bin/env python3
"""Add CIEL mapping references to one of the MOH's OCL collections.

    OCL_API_TOKEN=... scripts/build/ocl-add-mappings.py --types Q-AND-A
    OCL_API_TOKEN=... scripts/build/ocl-add-mappings.py --types Q-AND-A --apply

This WRITES TO THE MOH'S OCL ORGANISATION. Nothing in the build calls it and it must never
be wired into CI; it exists so a collection-wide repair is reviewable and repeatable instead
of a hand-rolled curl loop.

DRY RUN by default. Without --apply it reports exactly what it would add and changes nothing.

Why this is needed: LIB/mch was populated with concept-only references, so it holds ~825
concepts and ZERO mappings. Every coded question in it therefore loads with no answers
attached, and no SAME-AS mapping reaches the runtime -- which is why `Same as mappings` in our
concept CSVs has never been loadable ("Concept Source is required").

A Q-AND-A mapping whose answer concept is absent from the collection is NOT added: it would
resolve to nothing and reproduce, in mapping form, the exact defect this repairs. Those are
reported so the missing answers can be added first with ocl-add-concepts.sh.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCL_API_URL = os.environ.get("OCL_API_URL", "https://api.openconceptlab.org").rstrip("/")
OCL_ORG = os.environ.get("OCL_ORG", "LIB")
OCL_COLLECTION = os.environ.get("OCL_COLLECTION", "mch")
CIEL_SOURCE = "/orgs/CIEL/sources/CIEL"
EXPORT_DIR = ROOT / "content-packages/content-common/configuration/backend_configuration/ocl"

# OCL allows 500 requests/minute. Stay clearly under it: a 429 midway through a multi-thousand
# item run leaves the collection half-repaired, which is worse than taking longer.
REQUESTS_PER_MINUTE = 300


def api(token: str, method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{OCL_API_URL}{path}", data=data, method=method,
        headers={"Authorization": f"Token {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:500]


def collection_concept_ids() -> set[str]:
    """Read the collection's concepts from the local export rather than paging the API.

    The export is the same artefact the build consumes, so this also keeps the check honest:
    it asks "what will actually load", not "what does the collection claim".
    """
    zips = sorted(EXPORT_DIR.glob(f"lib-{OCL_COLLECTION}-ciel-*.zip"))
    if not zips:
        sys.exit(f"FAIL: no {OCL_COLLECTION} export in {EXPORT_DIR}. Run fetch-ciel.sh first.")
    with zipfile.ZipFile(zips[-1]) as z:
        doc = json.load(z.open("export.json"))
    return {str(c["id"]) for c in doc["concepts"]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("concepts", nargs="*",
                    help="CIEL concept ids. Default: every concept in the collection.")
    ap.add_argument("--types", default="SAME-AS,Q-AND-A",
                    help="Comma-separated map_types to add. Default: SAME-AS,Q-AND-A")
    ap.add_argument("--apply", action="store_true", help="Actually add the references.")
    ap.add_argument("--batch", type=int, default=100, help="Expressions per PUT. Default 100.")
    ap.add_argument("--token", default=os.environ.get("OCL_API_TOKEN", ""))
    args = ap.parse_args()

    if not args.token:
        print("FAIL: set OCL_API_TOKEN or pass --token.", file=sys.stderr)
        return 2

    wanted = {t.strip() for t in args.types.split(",") if t.strip()}
    in_collection = collection_concept_ids()
    targets = args.concepts or sorted(in_collection)
    print(f"== collection {OCL_ORG}/{OCL_COLLECTION}: {len(in_collection)} concepts in the export ==")
    print(f"== scanning {len(targets)} concept(s) for {sorted(wanted)} mappings ==")

    delay = 60.0 / REQUESTS_PER_MINUTE
    expressions: list[str] = []
    kept = Counter()
    skipped_missing_target: list[tuple[str, str]] = []
    for n, cid in enumerate(targets, 1):
        status, body = api(args.token, "GET", f"{CIEL_SOURCE}/concepts/{cid}/mappings/?limit=200")
        time.sleep(delay)
        if status != 200 or not isinstance(body, list):
            print(f"  WARN: could not read mappings for CIEL:{cid} (HTTP {status})", file=sys.stderr)
            continue
        for m in body:
            mt = m.get("map_type")
            if mt not in wanted:
                continue
            # Only Q-AND-A points at a concept that must itself be present; a SAME-AS points at
            # an external terminology (SNOMED, ICD) and is self-contained.
            if mt == "Q-AND-A" and str(m.get("to_concept_code")) not in in_collection:
                skipped_missing_target.append((cid, str(m.get("to_concept_code"))))
                continue
            if m.get("url"):
                expressions.append(m["url"])
                kept[mt] += 1
        if n % 50 == 0:
            print(f"   scanned {n}/{len(targets)} concepts, {len(expressions)} mappings so far")

    print()
    print(f"== {len(expressions)} mapping reference(s) to add: {dict(kept)} ==")
    if skipped_missing_target:
        print(f"== {len(skipped_missing_target)} Q-AND-A mapping(s) SKIPPED: answer concept not in the collection ==")
        for cid, tgt in skipped_missing_target[:20]:
            print(f"   CIEL:{cid} -> answer CIEL:{tgt} (add the answer concept first)")
        if len(skipped_missing_target) > 20:
            print(f"   ... and {len(skipped_missing_target) - 20} more")

    if not expressions:
        print("\nNothing to add.")
        return 0

    if not args.apply:
        print("\nDRY RUN — nothing was sent. Re-run with --apply.")
        print(f"Example expression: {expressions[0]}")
        return 0

    added = failed = 0
    for i in range(0, len(expressions), args.batch):
        chunk = expressions[i:i + args.batch]
        status, body = api(args.token, "PUT",
                           f"/orgs/{OCL_ORG}/collections/{OCL_COLLECTION}/references/",
                           {"data": {"expressions": chunk}})
        if status not in (200, 201, 202):
            print(f"FAIL: batch at {i} returned HTTP {status}: {str(body)[:300]}", file=sys.stderr)
            return 1
        for item in (body or []):
            if item.get("added"):
                added += 1
            else:
                failed += 1
        print(f"   batch {i // args.batch + 1}: {added} added, {failed} rejected so far")
        time.sleep(delay)

    print(f"\n== added {added}, rejected {failed} ==")
    print("Rejections are usually 'must be unique in a collection' — already present, harmless.")
    print("\nNEXT: cut a new released collection version and bump ocl.collection.version in")
    print("distribution/distro.properties, then re-run scripts/build/fetch-ciel.sh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
