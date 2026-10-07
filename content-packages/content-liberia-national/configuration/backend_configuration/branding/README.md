# Backend branding — logos on server-rendered PDFs

Not an Initializer domain. Initializer skips this directory; it ships in the resolved
configuration only so the `patientdocuments` and `billing` modules can read it from the
application data directory at `/openmrs/data/configuration/branding/`.

| File | Referenced from |
| --- | --- |
| `moh-liberia-seal.png` | `jsonkeyvalues/patientdocuments-national.json`: `report.patientIdSticker.logourl` (patient card) and `report.encounterPrinting.logopath` (printed encounter forms) |
| | `globalproperties/gp-billing.xml`: `billing.receipt.logoPath` (bill receipt PDF from the billing module) |

The seal is the raster embedded in `distribution/frontend/branding/moh-liberia-logo.svg`,
extracted unchanged. The SVG itself does not work here: its lettering is white for the blue
navigation bar, and the module embeds the file as `data:image/png`, so it must be a PNG.

The paths are relative to the application data directory. `patientdocuments` rejects absolute
paths and `..`; `billing` would accept an absolute path, but keep them relative so both read
the same file. If the file is missing, both fall back to the OpenMRS logo without failing, so a
wrong path shows up only on the printout.

Obtain any replacement MOH mark from the Ministry; do not approximate it.
