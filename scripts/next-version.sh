#!/usr/bin/env bash
# Prints the version of the next release.
# The version in package.json wins when it is ahead of the latest v* tag;
# otherwise the patch number of the latest tag goes up by one.
set -euo pipefail

cd "$(dirname "$0")/.."
base="$(node -p "require('./package.json').version")"
latest="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n 1)"
latest="${latest#v}"

if [ -z "$latest" ]; then
  echo "$base"
elif [ "$base" != "$latest" ] && [ "$(printf '%s\n%s\n' "$base" "$latest" | sort -V | tail -n 1)" = "$base" ]; then
  echo "$base"
else
  IFS=. read -r major minor patch <<< "$latest"
  echo "$major.$minor.$((patch + 1))"
fi
