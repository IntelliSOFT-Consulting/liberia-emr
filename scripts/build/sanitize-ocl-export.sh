#!/usr/bin/env bash
# Normalizes OCL export ZIPs for the OpenMRS concept validator.
#
# Some upstream CIEL exports carry duplicate concept names on the same concept in the same
# locale, usually a retired historical synonym plus the active name that replaced it.
# OpenMRS 2.8 rejects those during import with DuplicateConceptNameException, even when one
# duplicate is retired. This script keeps the best name in each duplicate set and rewrites
# the ZIP in-place before the content package is assembled.
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
        if dropped == 0:
            print(f"OCL sanitize: {os.path.basename(zip_path)} already clean")
            continue

        fd, tmp_path = tempfile.mkstemp(suffix=".zip")
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

    print(f"OCL sanitize: {os.path.basename(zip_path)} removed {dropped} duplicate concept names")
PY
