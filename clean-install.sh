#!/bin/bash

set -e

echo "🧹 Starting clean install..."

echo "→ Resetting Nx cache..."
pnpm nx reset || true

echo "→ Removing root node_modules..."
rm -rf node_modules

echo "→ Removing app node_modules..."
rm -rf apps/web/node_modules
rm -rf apps/api/node_modules
rm -rf apps/mobile/node_modules

echo "→ Removing library node_modules..."
find libs -type d -name "node_modules" -prune -exec rm -rf '{}' + 2>/dev/null || true

echo "→ Removing build/cache directories..."
rm -rf apps/web/.next
rm -rf apps/mobile/.expo
rm -rf dist
rm -rf .nx/cache

echo "→ Installing dependencies..."
pnpm install

echo ""
echo "✅ Clean install completed successfully."
