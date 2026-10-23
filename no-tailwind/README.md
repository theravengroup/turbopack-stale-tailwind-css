# Repro: a Turbopack warm build hands a transform the previous build's file content

No Tailwind. The only transform is `./plugin`, a small stylesheet "compiler" that keeps per-file
state between calls, the way `@tailwindcss/turbopack` 4.3.3 and `@tailwindcss/postcss` before
4.3.3 did:

- It keeps the compiled stylesheet for the life of the worker process, keyed by file path, and
  recompiles only when the file's mtime changes.
- It reads `app/page.jsx` and registers it as a dependency (`this.addDependency` as a loader, a
  `dependency` message as a PostCSS plugin), so a change to the page re-runs it.

Each call appends a line to `plugin.trace`: worker pid, start and end time, the stylesheet version
it was handed (`in`), the version it emitted (`out`), the page version it read, and whether its
cache was used.

Filed as vercel/next.js#100326.

```bash
pnpm install
./repro.sh loader 20     # plugin/loader.cjs as a turbopack.rules loader for *.css
./repro.sh postcss 20    # plugin/index.cjs as a PostCSS plugin through postcss.config.mjs
node trace-summary.mjs   # per setting: builds where the transform was handed the v1 stylesheet
```

`TURBO_ENGINE_READ_CONCURRENCY` sets the warm build's read concurrency (default here 1; Vercel's
Next.js adapter sets 4 on CI production builds; Turbopack's default is 64). `STATELESS=1` turns
the transform's cache off, which shows the calls without the wrong output.

## What `repro.sh` does

For each run:

1. Writes v1: `app/globals.css` sets `--repro-stylesheet: "v1"`, and `app/page.jsx` has
   `data-version="v1"`.
2. Runs a cold `next build`, then deletes everything in `.next` except `.next/cache`. That's what
   Vercel restores between deployments.
3. Writes v2 of both files, as in a commit that touches the stylesheet and a component.
4. Runs a warm `next build`.
5. Checks the emitted CSS. `--repro-stylesheet:"v2"` with `--repro-page:"v2"` is correct.
   `"v1"` with page `"v2"` is stale: the v1 stylesheet shipped with output from the v2 build.

Expected: every run `ok`, and no call ever handed `in=v1` during a warm build. Actual, on an M5
Mac (10 cores, macOS, Node 24.22.0), with other processes keeping the load average between 4
and 30:

| next | Path | `TURBO_ENGINE_READ_CONCURRENCY` | Stale CSS | Warm builds where a call got v1 |
|---|---|---|---|---|
| 16.5.0-canary.25 | loader | 1 | 18/20 | 18/20 |
| 16.5.0-canary.25 | loader | 4 | 17/20 | 17/20 |
| 16.5.0-canary.25 | loader | 64 | 0/20 | 0/20 |
| 16.5.0-canary.25 | loader, `STATELESS=1` | 1 | 0/20 | 19/20 |
| 16.5.0-canary.25 | postcss | 1 | 0/20 | 0/20 |
| 16.5.0-canary.25 | postcss | 4 | 0/20 | 0/20 |
| 16.5.0-canary.25 | postcss | 64 | 0/20 | 0/20 |
| 16.4.3 | loader | 1 | 9/10 | 9/10 |
| 16.4.3 | loader | 4 | 7/10 | 7/10 |
| 16.4.3 | postcss | 1 | 0/10 | 0/10 |
| 16.4.3 | postcss | 4 | 0/10 | 0/10 |
| 16.3.8 | postcss | 1 | 0/10 | 0/10 |
| 16.3.8 | postcss | 4 | 0/10 | 0/10 |

In every warm build where a call got v1, there were exactly two calls, both in one worker
process: the v1 call, which finished before the v2 call started, then the v2 call. With the
cache on, the v2 call found an unchanged mtime and returned the v1 compile. With `STATELESS=1`
the same two calls happen and the output is correct.

In postcss mode the plugin ran once per warm build, always on v2. It is wired up: a warm build
that changes only `app/page.jsx` re-runs it.
