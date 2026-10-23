#!/usr/bin/env bash
# A Turbopack warm build hands a transform the previous build's stylesheet. No Tailwind: the
# only transform is ./plugin, a stylesheet compiler that keeps per-file state between calls.
#
#   ./repro.sh loader  [runs]   ./plugin/loader.cjs as a turbopack.rules webpack loader for *.css
#   ./repro.sh postcss [runs]   ./plugin/index.cjs as a PostCSS plugin through postcss.config.mjs
#
# Each run: cold-build v1, keep only .next/cache (what Vercel restores between deployments),
# switch to v2 (the stylesheet AND the page change, as in a normal commit), warm-build, and check
# which stylesheet the emitted CSS was compiled from. Every transform call is logged to
# plugin.trace. Exits 1 if any warm build emitted stale CSS. Default 10 runs.
#
# The warm build runs with TURBO_ENGINE_READ_CONCURRENCY=1 unless you set it. Vercel's Next.js
# adapter sets it to 4 for every CI production build; Turbopack's default is 64.
# STATELESS=1 turns the transform's cache off (a control: the trace still shows every call).
set -euo pipefail
cd "$(dirname "$0")"
mode=${1:?usage: ./repro.sh loader|postcss [runs]}
runs=${2:-10}
concurrency=${TURBO_ENGINE_READ_CONCURRENCY:-1}
export NEXT_TELEMETRY_DISABLED=1

rm -f postcss.config.mjs plugin/stateless
case $mode in
  loader)
    cat > next.config.mjs <<'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["repro-stateful-plugin/loader.cjs"], as: "*.css" },
    },
  },
};

export default nextConfig;
EOF
    ;;
  postcss)
    printf '/** @type {import('"'"'next'"'"').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n' > next.config.mjs
    cat > postcss.config.mjs <<'EOF'
const config = {
  plugins: {
    "repro-stateful-plugin": {},
  },
};

export default config;
EOF
    ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
label="$mode, TURBO_ENGINE_READ_CONCURRENCY=$concurrency"
if [ "${STATELESS:-0}" = 1 ]; then
  touch plugin/stateless
  label="$label, stateless"
fi

write_version() {
  local version=$1
  printf ':root {\n  --repro-stylesheet: "%s";\n}\n' "$version" > app/globals.css
  printf 'export default function Page() {\n  return <h1 data-version="%s">Hello</h1>;\n}\n' "$version" > app/page.jsx
}
trap 'write_version v1; rm -f plugin/stateless' EXIT

stale=0
for i in $(seq 1 "$runs"); do
  rm -rf .next
  write_version v1
  echo "--- run $i cold ($label)" >> plugin.trace
  ./node_modules/.bin/next build > cold.log 2>&1
  find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +

  write_version v2
  echo "--- run $i warm ($label)" >> plugin.trace
  TURBO_ENGINE_READ_CONCURRENCY=$concurrency ./node_modules/.bin/next build > warm.log 2>&1

  css=$(find .next/static -name '*.css' -exec cat {} +)
  sheet=$(grep -o 'repro-stylesheet:"v[12]"' <<<"$css" | grep -o 'v[12]' || echo "?")
  page=$(grep -o 'repro-page:"v[12]"' <<<"$css" | grep -o 'v[12]' || echo "?")
  if [ "$sheet" = v1 ] && [ "$page" = v2 ]; then
    stale=$((stale + 1))
    verdict="STALE: v2 page output combined with the v1 stylesheet"
  elif [ "$sheet" = v2 ] && [ "$page" = v2 ]; then
    verdict="ok"
  else
    verdict="unexpected"
  fi
  echo "run $i: stylesheet=$sheet page=$page -> $verdict"
done
echo "$stale/$runs warm builds emitted stale CSS ($label)"
[ "$stale" -eq 0 ]
