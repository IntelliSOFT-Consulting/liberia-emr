# Patch sidecar — esm-patient-registration-app skip logic and radio coded attributes

| Field | Value |
| --- | --- |
| Upstream repo | `openmrs/openmrs-esm-patient-management` |
| Upstream PR | https://github.com/openmrs/openmrs-esm-patient-management/pull/2741 |
| Component version patched | `@openmrs/esm-patient-registration-app` `11.1.0` (pinned in `distribution/distro.properties`) |
| Why not configuration | 11.1.0 has no conditional display: every configured section and field always renders, and coded person attributes render only as a `Select`. LE-223 needs the referral fields shown only after "Has the patient been referred?" is answered Yes. |
| Removal condition | Bump `@openmrs/esm-patient-registration-app` to a release containing #2741. Then delete the three skip-logic/radio entries and their helpers from `distribution/frontend/patch-patient-registration.cjs`, `patch-patient-registration.test.cjs`, and this file. The config keys (`hideIf`, `displayStyle`) stay as they are. |
| Owner | `@Muta-Jonathan` |

## What the patch does

In chunk `555.js` (config schema), `sectionDefinitions[]` gain `hideIf` and `hideIfAge`, and `fieldDefinitions[]` gain `hideIf`, `hideIfAge` and `displayStyle` (`dropdown` | `radio`), with the PR's validators.

In chunk `5395.js`:

- The PR's `getHiddenElements` / `sanitizeFormValuesForSkipLogic` logic is injected at module scope as `__liberiaEmr*` helpers.
- Field (`nq`) and SectionWrapper (`te`) return `null` when hidden. The "Jump to" links skip hidden sections.
- `onSubmit` drops the values of hidden fields before saving.
- CodedPersonAttributeField (`eU`) renders a Carbon `ContentSwitcher` when `displayStyle` is `radio`, and validates `required`.

The PR's other changes (`hiddenElements` on the registration context, the `.radioField` SCSS, translations) are not ported. Each component computes the hidden set itself, and the switcher's layout is set inline.

## Build safety

The same as the other registration patches. Every anchor must occur exactly once across the bundle, a second run throws on its marker, and the directory is renamed to `openmrs-esm-patient-registration-app-11.1.0-liberia3`.
