# Patch sidecar — esm-form-engine-app checkbox required message

| Field | Value |
| --- | --- |
| Upstream repo | `openmrs/openmrs-esm-form-engine-lib` (bundled into `@openmrs/esm-form-engine-app`) |
| Upstream PR | https://github.com/openmrs/openmrs-esm-form-engine-lib/pull/840 |
| Component version patched | `@openmrs/esm-form-engine-app` `12.3.4` (pinned in `distribution/distro.properties`). The bug is in the lib copy baked into that app. Lib `4.2.1` (current when 12.3.4 was published), lib `4.3.0`, and `main` as of 2026-10-08 all omit the props. |
| Why not configuration | Purpose of Visit is already `rendering: "checkbox"` and `required: true`. The engine blocks Save and computes `Field is mandatory`. The non-searchable checkbox renderer drops `errors` / `warnings` instead of passing them to Carbon `CheckboxGroup`. A schema validator, a `required` expression, or `checkbox-searchable` does not fix the checklist control. Custom controls cannot replace the inbuilt `checkbox` registration. |
| Removal condition | Bump `@openmrs/esm-form-engine-app` to a release whose bundle passes `invalid`, `invalidText`, `warn` and `warnText` on the non-searchable `CheckboxGroup`. A form-engine-lib release is not enough until the app is rebuilt against it. Then delete this file, `distribution/frontend/patch-form-engine-checkbox.cjs`, its test, and the `COPY` + `RUN` lines in `distribution/frontend/Dockerfile`. |
| Owner | `@Samstar10` |

## What the patch does

In `@openmrs/esm-form-engine-app@12.3.4` chunk `5708.js`, the ordinary checkbox branch is:

```js
b().createElement(B.$QX,{legendText:b().createElement(Sh,{field:e}),readOnly:(0,nI.H)(e.readonly)}
```

`B.$QX` is Carbon `CheckboxGroup`. `n` and `S` are that component's `errors` and `warnings`. The patch adds the same props the searchable branch already passes to `FilterableMultiSelect`:

```js
invalid:n.length>0,invalidText:n[0]?.message,warn:S.length>0,warnText:S[0]?.message
```

Carbon then renders `.cds--form-requirement` with the existing validator message (`Field is mandatory` when the group is required and empty) and adds `.cds--checkbox-group--invalid`. It does not render that message when `readOnly` is set. The required asterisk stays on `FieldLabel`. The searchable branch is not rewritten.

## Build safety

- Missing `openmrs-esm-form-engine-app-12.3.4` fails the image build.
- The anchor must occur exactly once. A drifted minify fails the build before any write.
- The lock string `__liberiaEmrCheckboxRequired` makes a second run throw.
- The import map must contain the unpatched directory name exactly once. The directory is renamed to `openmrs-esm-form-engine-app-12.3.4-liberia1`.

## Upstream change

In `src/components/inputs/multi-select/multi-select.component.tsx`, the non-searchable `CheckboxGroup` should receive the validation props already used by `FilterableMultiSelect` in the same file:

```tsx
<CheckboxGroup
  legendText={<FieldLabel field={field} />}
  readOnly={isTrue(field.readonly)}
  invalid={errors.length > 0}
  invalidText={errors[0]?.message}
  warn={warnings.length > 0}
  warnText={warnings[0]?.message}
>
```
