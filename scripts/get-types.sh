#!/usr/bin/env bash
# Downloads Seanime's plugin type definitions into ./types so editors
# (VS Code, etc.) can type-check and autocomplete $ui, $app, $storage, etc.
# These files are NOT required at runtime -- Seanime evaluates the .ts
# payload itself -- this is purely for local development convenience.
set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/5rahim/seanime/refs/heads/main/internal/extension_repo/goja_plugin_types"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/types"

mkdir -p "$DEST"

for f in plugin.d.ts app.d.ts system.d.ts core.d.ts; do
    echo "Fetching $f..."
    curl -fsSL "$BASE_URL/$f" -o "$DEST/$f"
done

echo "Done. Type definitions written to $DEST"
