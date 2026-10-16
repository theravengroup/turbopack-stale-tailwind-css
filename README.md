# Repro: stale Tailwind CSS after a Turbopack build-cache restore

Next.js 16.4.2 (Turbopack, `turbopackFileSystemCacheForBuild` on by default) with
`@tailwindcss/turbopack` 4.3.3. It also reproduces on 16.4.1 and 16.5.0-canary.15. After a warm
`next build` over a restored `.next/cache`, the emitted CSS can contain the new commit's utilities
compiled against the **previous** commit's stylesheet.

```bash
pnpm install
./repro.sh          # 10 runs; exits 1 if any warm build emitted stale CSS
node loader-direct.mjs   # the loader half on its own, deterministic
```

## What `repro.sh` does

For each run:

1. Writes v1: `app/globals.css` sets `--repro-stylesheet: "v1"`, and `app/page.jsx` uses
   `text-xl`.
2. Runs a cold `next build`, then deletes everything in `.next` except `.next/cache`. That's what
   Vercel restores between deployments.
3. Writes v2: the stylesheet now says `"v2"`, and the page adds `underline`. A normal commit
   that touches both the stylesheet and a component.
4. Runs a warm `next build` with `TURBO_ENGINE_READ_CONCURRENCY=1`. Vercel's Next.js adapter sets
   4 on every CI production build; Turbopack's default is 64.
5. Checks the emitted CSS. `"v2"` plus `.underline` is correct. `"v1"` plus `.underline` is stale:
   v2's utilities compiled against the v1 stylesheet.

Expected: every run `ok`. Actual, on an M-series Mac:

| next | `TURBO_ENGINE_READ_CONCURRENCY=1` | `=4` | `=64` (default) |
|---|---|---|---|
| 16.4.1 | 18/33 stale | 2/10 | 0/5 |
| 16.4.2 | 4/10 | 4/10 | not run |
| 16.5.0-canary.15 | 7/10 | 2/10 | not run |

## Why

- After the cache restore, every file read is dirty until it's redone. Turbopack can run the
  Tailwind loader as soon as `app/page.jsx` is re-read, while the loader's input is still the
  cached v1 `globals.css`. When the `globals.css` read finishes, Turbopack runs the loader again
  with v2.
- If that second call lands in the same Node worker, `@tailwindcss/turbopack` reuses the compiler
  built from v1. It rebuilds only when the file's mtime changes, and the mtime didn't change
  between the two calls. `loader-direct.mjs` shows this part without Turbopack.

## Controls

- Change only the stylesheet: never stale (0/8).
- `experimental.turbopackFileSystemCacheForBuild: false`: never stale (0/5).
- Make the loader rebuild when `source` differs from the last call (like `@tailwindcss/postcss`
  since tailwindlabs/tailwindcss#20310): never stale (0/10).
