#!/usr/bin/env bash
# Packs the built application into release/mockpit-<version>.zip.
# The archive needs only Node.js to run: it holds the compiled server with its
# production dependencies and the built web UI.
#
# Usage: pnpm build && scripts/package-release.sh <version>
set -euo pipefail

version="${1:?usage: scripts/package-release.sh <version>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/release"
stage="$out/mockpit"

for built in apps/server/dist/index.js apps/web/dist/index.html; do
  if [ ! -f "$root/$built" ]; then
    echo "$built is missing, run \"pnpm build\" first" >&2
    exit 1
  fi
done

rm -rf "$out"
mkdir -p "$stage/apps/web"

# Hoisted layout: a plain node_modules tree without symlinks, so the archive
# also unpacks correctly on Windows.
cd "$root"
pnpm --filter @mockpit/server deploy --prod --legacy --config.node-linker=hoisted \
  "$stage/apps/server"
rm -rf "$stage/apps/server/node_modules/.bin" "$stage/apps/server/node_modules/.modules.yaml" \
  "$stage/apps/server/src" "$stage/apps/server/test" "$stage/apps/server"/tsconfig*.json \
  "$stage/apps/server"/vitest.config.*
# The server reports the version found in its package.json.
node -e '
  const fs = require("node:fs");
  const [file, version] = process.argv.slice(1);
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
' "$stage/apps/server/package.json" "$version"
cp -r apps/web/dist "$stage/apps/web/dist"
cp LICENSE THIRD_PARTY_NOTICES.md "$stage/"

if [ -n "$(find "$stage" -type l -print -quit)" ]; then
  echo "the package contains symlinks:" >&2
  find "$stage" -type l >&2
  exit 1
fi

cat > "$stage/start.sh" <<'EOF'
#!/bin/sh
# Starts Mockpit. Data is kept in the "data" folder next to this file.
cd "$(dirname "$0")" || exit 1
exec node apps/server/dist/index.js
EOF
chmod +x "$stage/start.sh"

printf '%s\r\n' \
  '@echo off' \
  'rem Starts Mockpit. Data is kept in the "data" folder next to this file.' \
  'cd /d "%~dp0"' \
  'node apps\server\dist\index.js' \
  'if errorlevel 1 pause' > "$stage/start.cmd"

cat > "$stage/README.txt" <<EOF
Mockpit $version

Requires Node.js 22 or newer (https://nodejs.org). Nothing needs to be installed or built.

Start:
  Windows:      double-click start.cmd
  Linux, macOS: ./start.sh

The first start prints the address of the interface and a generated password.
Open the address in a browser and log in with that password.

All data (settings, password, environments) is kept in the "data" folder next to
this file. To update, unpack a newer release and move the "data" folder into it.

Configuration (MOCKPIT_PORT, MOCKPIT_PASSWORD and others) is described at
https://github.com/mcbane23/mockoon-web#readme
EOF

(cd "$out" && zip -qr "mockpit-$version.zip" mockpit)
rm -rf "$stage"
echo "$out/mockpit-$version.zip"
