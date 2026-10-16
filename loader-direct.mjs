// Deterministic half of the repro, without Next.js or Turbopack: call @tailwindcss/turbopack twice in
// one process for the same stylesheet with different `source`, the file's mtime unchanged in between
// (which is what Turbopack does when it re-runs a loader in the same worker). The second result
// should come from the second source.
//
//   node loader-direct.mjs
import path from "node:path";
import loader from "@tailwindcss/turbopack";

const resourcePath = path.resolve(import.meta.dirname, "app/globals.css");
const stylesheet = (version) => `@import "tailwindcss";\n\n:root {\n  --repro-stylesheet: "${version}";\n}\n`;

function runLoader(source) {
  return new Promise((resolve, reject) => {
    loader.call(
      {
        resourcePath,
        resource: resourcePath,
        getOptions: () => ({ base: import.meta.dirname }),
        async: () => (error, output) => (error ? reject(error) : resolve(output)),
        addDependency() {},
        addContextDependency() {},
      },
      source,
    );
  });
}

const compiledFrom = (css) => css.match(/--repro-stylesheet:\s*"(v\d)"/)?.[1] ?? "?";

const first = await runLoader(stylesheet("v1"));
const second = await runLoader(stylesheet("v2"));
console.log(`call 1 with v1 source -> output compiled from ${compiledFrom(first)}`);
console.log(`call 2 with v2 source -> output compiled from ${compiledFrom(second)}`);
if (compiledFrom(second) !== "v2") {
  console.log("STALE: the loader reused the compiler built from the previous source");
  process.exit(1);
}
console.log("ok");
