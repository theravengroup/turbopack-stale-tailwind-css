#!/usr/bin/env bash
# Stale Tailwind CSS from a restored Turbopack persistent build cache.
#
# Each run: cold-build v1, keep only .next/cache (what Vercel restores between deployments),
# switch to v2 (the stylesheet AND a component change, as in a normal commit), warm-build,
# and check which stylesheet the emitted CSS was compiled from.
#
#   ./repro.sh [runs]        default 10 runs; exits 1 if any warm build emitted stale CSS
#
# The warm build runs with TURBO_ENGINE_READ_CONCURRENCY=1 unless you set it. Vercel's Next.js
# adapter sets it to 4 for every CI production build; Turbopack's default is 64.
set -euo pipefail
cd "$(dirname "$0")"
runs=${1:-10}
export NEXT_TELEMETRY_DISABLED=1

write_version() {
  local version=$1 classes=$2
  printf '@import "tailwindcss";\n\n:root {\n  --repro-stylesheet: "%s";\n}\n' "$version" > app/globals.css
  printf 'export default function Page() {\n  return <h1 className="text-xl %s">Hello</h1>;\n}\n' "$classes" > app/page.jsx
}
trap 'write_version v1 ""' EXIT

stale=0
for i in $(seq 1 "$runs"); do
  rm -rf .next
  write_version v1 ""
  ./node_modules/.bin/next build > cold.log 2>&1
  find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +

  write_version v2 "underline"
  TURBO_ENGINE_READ_CONCURRENCY=${TURBO_ENGINE_READ_CONCURRENCY:-1} ./node_modules/.bin/next build > warm.log 2>&1

  css=$(find .next/static -name '*.css' -exec cat {} +)
  sheet=$(grep -o 'repro-stylesheet:"v[12]"' <<<"$css" | grep -o 'v[12]' || echo "?")
  underline=$(grep -q 'text-decoration-line:underline' <<<"$css" && echo yes || echo no)
  if [ "$sheet" = v1 ] && [ "$underline" = yes ]; then
    stale=$((stale + 1))
    verdict="STALE: v2's utilities compiled against the v1 stylesheet"
  elif [ "$sheet" = v2 ] && [ "$underline" = yes ]; then
    verdict="ok"
  else
    verdict="unexpected"
  fi
  echo "run $i: stylesheet=$sheet underline=$underline -> $verdict"
done
echo "$stale/$runs warm builds emitted stale CSS"
[ "$stale" -eq 0 ]
