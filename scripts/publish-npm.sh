#!/usr/bin/env bash
# Publish @anht3889/dsh-web-search-bundle from packages/bundle.
# Skips when this version is already on the registry.
set -euo pipefail

if [[ -z "${NODE_AUTH_TOKEN:-}" && "${DRY_RUN:-false}" != "true" ]]; then
  echo "NODE_AUTH_TOKEN (NPM_TOKEN secret) is required to publish" >&2
  exit 1
fi

dir=packages/bundle
name="$(node -p "require('./${dir}/package.json').name")"
version="$(node -p "require('./${dir}/package.json').version")"

if [[ "$version" == *-* ]]; then
  tag=next
else
  tag=latest
fi

if npm view "${name}@${version}" version >/dev/null 2>&1; then
  echo "skip ${name}@${version} (already on npm)"
  exit 0
fi

# Publish with npm: pnpm publish can leave the registry's top-level readme
# metadata empty, so the npmjs package page stays blank even when README.md
# is in the tarball.
args=(publish --access public --tag "$tag")
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  args+=(--dry-run)
fi

echo "publish ${name}@${version} (tag=${tag})"
(cd "$dir" && npm "${args[@]}")
