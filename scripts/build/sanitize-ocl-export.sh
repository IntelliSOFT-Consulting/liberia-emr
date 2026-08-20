#!/usr/bin/env bash
# Normalizes OCL export ZIPs for the OpenMRS concept validator.
#
# Two defects are repaired, both present in upstream exports we do not control:
#
# 1. Duplicate concept names on the same concept in the same locale, usually a retired
#    historical synonym plus the active name that replaced it. OpenMRS 2.8 rejects those
#    during import with DuplicateConceptNameException, even when one duplicate is retired.
#    The best name in each duplicate set is kept.
#
# 2. Orphan mappings — a mapping whose from_concept_url is empty, so it names no source
#    concept and cannot describe anything. The importer rejects each one with "Cannot create
#    mapping from concept with URL /, because the concept has not been imported".
#
#    Dropping these is not cosmetic. openconceptlab's ImportServiceImpl.failImport() marks
#    the WHOLE import failed on any item error at all, with the message "Errors found";
#    Initializer's OpenConceptLabLoader then rethrows that, and the release gate fails the
#    build. CIEL v2026-07-20 carries exactly 10 such mappings out of 300,246 — enough to
#    fail every clean install of this distribution, and nothing in our own content can fix
#    them. A mapping with no source concept is unimportable by definition, so removing it
#    loses nothing.
#
# The ZIP is rewritten in place, before the content package is assembled.
set -euo pipefail

[[ $# -gt 0 ]] || { echo "usage: $0 <ocl-export.zip>..." >&2; exit 2; }

command -v python3 >/dev/null || { echo "python3 is required to sanitize OCL exports" >&2; exit 1; }

python3 - "$@" <<'PY'
import json
import os
import sys
import tempfile
import zipfile


def best_rank(name):
    return (
        0 if name.get("retired") is False else 1,
        0 if name.get("locale_preferred") is True else 1,
        0 if name.get("name_type") == "FULLY_SPECIFIED" else 1,
        name.get("external_id") or "",
        name.get("uuid") or "",
        name.get("id") or "",
    )


def sanitize_export(export):
    dropped = 0
    for concept in export.get("concepts") or []:
        names = concept.get("names")
        if not isinstance(names, list):
            continue

        grouped = {}
        for index, name in enumerate(names):
            if not isinstance(name, dict):
                continue

            clean_name = (name.get("name") or "").strip()
            if not clean_name:
                continue

            normalized = dict(name)
            normalized["name"] = clean_name
            key = (normalized.get("locale") or "", clean_name.casefold())
            rank = best_rank(normalized)

            previous = grouped.get(key)
            if previous is None or rank < previous[0]:
                grouped[key] = (rank, index, normalized)

        sanitized = [entry[2] for entry in sorted(grouped.values(), key=lambda entry: entry[1])]
        dropped += len(names) - len(sanitized)
        concept["names"] = sanitized

    return dropped


def drop_orphan_mappings(export):
    """Remove mappings that name no source concept.

    Matched on from_concept_url alone: that is the field the importer dereferences, and an
    empty one is what it reports as "concept with URL /". Deliberately narrow — a mapping
    whose source exists but whose TARGET is unresolvable is a different thing, which the
    importer handles on its own, and which we must not silently discard.
    """
    mappings = export.get("mappings")
    if not isinstance(mappings, list):
        return 0

    kept = [
        m
        for m in mappings
        if not isinstance(m, dict) or (m.get("from_concept_url") or "").strip(" /")
    ]
    dropped = len(mappings) - len(kept)
    if dropped:
        export["mappings"] = kept
    return dropped


for zip_path in sys.argv[1:]:
    if not os.path.isfile(zip_path):
        print(f"missing OCL export: {zip_path}", file=sys.stderr)
        sys.exit(1)

    with zipfile.ZipFile(zip_path, "r") as source:
        if "export.json" not in source.namelist():
            print(f"skipping {os.path.basename(zip_path)}: no export.json")
            continue
        export = json.loads(source.read("export.json"))
        dropped = sanitize_export(export)
        orphans = drop_orphan_mappings(export)
        if dropped == 0 and orphans == 0:
            print(f"OCL sanitize: {os.path.basename(zip_path)} already clean")
            continue

        fd, tmp_path = tempfile.mkstemp(suffix=".zip.tmp", dir=os.path.dirname(zip_path))
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
                for info in source.infolist():
                    if info.filename == "export.json":
                        payload = json.dumps(export, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                        target.writestr(info, payload)
                    else:
                        target.writestr(info, source.read(info.filename))
            os.replace(tmp_path, zip_path)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    repairs = []
    if dropped:
        repairs.append(f"{dropped} duplicate concept names")
    if orphans:
        repairs.append(f"{orphans} orphan mappings")
    print(f"OCL sanitize: {os.path.basename(zip_path)} removed " + " and ".join(repairs))
PY
