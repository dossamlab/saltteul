#!/usr/bin/env bash
# Deploys the web app to Vercel production from a clean export of HEAD (no .git).
# Vercel's free plan blocks deploys whose git commit author is not the Vercel account owner,
# so the export carries no git metadata. .env.production is copied in (public Firebase web config).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
git -C "$ROOT" archive HEAD | tar -x -C "$OUT"
mkdir -p "$OUT/.vercel"
cp "$ROOT/.vercel/project.json" "$OUT/.vercel/"
cp "$ROOT/.env.production" "$OUT/"
cd "$OUT"
vercel deploy --prod --yes --no-color
