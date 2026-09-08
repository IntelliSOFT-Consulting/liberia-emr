# Patch sidecar — esm-service-queues-app default queue location

| Field | Value |
| --- | --- |
| Upstream repo | `openmrs/openmrs-esm-service-queues-app` |
| Upstream PR | **TODO — open this week and replace this line with the link** |
| Component version patched | `11.1.0` (pinned in `distribution/distro.properties`) |
| Why not configuration | `react-hook-form` evaluates `defaultValues` once at mount. `useSession()` resolves asynchronously via SWR, so `sessionLocation` is `undefined` on the first render tick and the `queueLocation` field always starts blank. No configuration key exists to inject a post-mount `useEffect`; the fix must be code-level. |
| Removal condition | Bump `@openmrs/esm-service-queues-app` to the upstream release that ships the fix, delete this file and `distribution/frontend/patch-service-queues-location.cjs`, and remove the corresponding `COPY` + `RUN` lines from `distribution/frontend/Dockerfile`. |
| Owner | **TODO — name the person chasing the upstream PR** |

## What the patch does

Injects a `useEffect` immediately after the existing `setOnSubmit` effect in the
`QueueFields` component (chunk `6138.js` of the assembled bundle). Once
`isLoadingQueueLocations` is false the effect either:

1. Clears `queueLocation` if the current value is not in the valid location list
   (handles the edge case where `useSession` was synchronous / cached and set a
   non-queue location as the default), or
2. Sets `queueLocation` to the session location UUID if the field is blank and the
   session location is a valid queue location.

Minified injection (O/G/E/k/F map to
`isLoadingQueueLocations / queueLocation / sessionLocation / memoizedQueueLocations / setValue`
in the anchor's scope in `chunk 6138.js` of 11.1.0 — confirmed by screen recording
against the actual distribution image build):

```js
(0,n.useEffect)(function(){
  O||(G?k.some(function(e){return e.id===G})||F("queueLocation",""):
      E&&E.uuid&&k.some(function(e){return e.id===E.uuid})&&F("queueLocation",E.uuid))
},[O,G,E,k,F])
```

## Build safety

- `fs.existsSync(moduleDir)` fails the build immediately if the assembled
  version is not `11.1.0`.
- Anchor-uniqueness check (`matches.length !== 1 || matches[0].anchorCount !== 1`)
  fails the build if the anchor drifts.
- Import-map entry count check fails the build if the module appears more than once.
- The lock string `__liberiaEmrServiceQueuesLocation` is embedded in the patched
  output; a second run throws `already patched` before any mutation.

## Screen-recording verification (Finding 4)

The PR screen recording must be captured against the actual `docker build` output of
this branch — not a local dev server — to confirm that O/G/E/k/F bind correctly in
the anchor's scope. Confirm in the PR description that the recording is from the
distribution image.
