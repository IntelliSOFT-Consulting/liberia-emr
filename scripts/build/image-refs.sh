#!/usr/bin/env bash
# Which image repositories a release build publishes (LE-360). One source of truth for
# build-distribution.sh (what it tags), release.yml (what it pushes) and the duplicate check.
#
#   scripts/build/image-refs.sh --site careysburg --role site     # the site-bearing images
#   scripts/build/image-refs.sh --role shared                     # the site-agnostic images
#   scripts/build/image-refs.sh --check careysburg barnersville central
#
# Prints one repository name per line, without registry or tag.
#
# Site-bearing images carry one site's content: the backend bakes in its site package, the
# frontend its site config. They are named per site (liberia-emr-backend-careysburg), the way
# -central and -demo already are, so two sites released at one version can never overwrite
# each other. Site-agnostic images (gateway, sync, broker, the exporters) are identical for every
# site; a release publishes them ONCE, from the first facility site in its list.
#
# --check fails if two sites in one release would publish the same repository, or if the list
# has no facility site to publish the shared images from.
set -euo pipefail

SITE=""
ROLE=""
CHECK=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)  SITE="$2"; shift 2 ;;
    --role)  ROLE="$2"; shift 2 ;;
    --check) shift; CHECK=("$@"); break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

shared() {
  printf '%s\n' liberia-emr-gateway liberia-emr-sync liberia-emr-sync-receiver \
    liberia-emr-broker liberia-emr-cert-expiry liberia-emr-sync-capture liberia-emr-sync-tunnel
}

site_images() {
  local site="$1"
  [[ "$site" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "invalid site name: '$site'" >&2; exit 2; }
  case "$site" in
    demo) echo "'demo' is a build flavour, not a site" >&2; exit 2 ;;
    central)
      # Central's own backend (every site's locations, LE-339 / ADR 0012) and frontend
      # (ADR 0011); it runs the site-agnostic images of the same release.
      echo liberia-emr-backend-central
      echo liberia-emr-frontend-central ;;
    *)
      echo "liberia-emr-backend-${site}"
      echo "liberia-emr-frontend-${site}" ;;
  esac
}

if [[ ${#CHECK[@]} -gt 0 ]]; then
  refs="$(
    for s in "${CHECK[@]}"; do site_images "$s" | sed "s|$| ${s}|"; done
    shared | sed 's|$| shared|'
  )"
  dups="$(echo "$refs" | awk '{print $1}' | sort | uniq -d)"
  if [[ -n "$dups" ]]; then
    echo "FAIL: one release would publish these repositories more than once:" >&2
    for d in $dups; do echo "  $d <- $(echo "$refs" | awk -v r="$d" '$1==r {print $2}' | paste -sd, -)" >&2; done
    exit 1
  fi
  owner=""
  for s in "${CHECK[@]}"; do [[ "$s" != "central" ]] && { owner="$s"; break; }; done
  [[ -n "$owner" ]] || { echo "FAIL: no facility site to publish the shared images from" >&2; exit 1; }
  echo "ok: $(echo "$refs" | wc -l | tr -d ' ') distinct repositories; shared images from ${owner}"
  exit 0
fi

case "$ROLE" in
  site)   [[ -n "$SITE" ]] || { echo "--role site needs --site" >&2; exit 2; }; site_images "$SITE" ;;
  shared) shared ;;
  *) echo "--role must be site or shared" >&2; exit 2 ;;
esac
