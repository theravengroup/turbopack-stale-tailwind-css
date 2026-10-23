// Summarises plugin.trace: for each setting, how many warm builds handed the transform the
// previous build's stylesheet (in=v1), and what happened around that call.
//
//   node trace-summary.mjs [plugin.trace]
import fs from "node:fs";

const lines = fs.readFileSync(process.argv[2] ?? "plugin.trace", "utf8").split("\n");
const settings = new Map();
let build = null;
for (const line of lines) {
  const header = line.match(/^--- run \d+ (cold|warm) \((.*)\)$/);
  if (header) {
    build = header[1] === "warm" ? { calls: [] } : null;
    if (build) {
      if (!settings.has(header[2])) settings.set(header[2], []);
      settings.get(header[2]).push(build);
    }
    continue;
  }
  if (build && line.startsWith("via=")) {
    build.calls.push(Object.fromEntries(line.split(" ").map((kv) => kv.split("="))));
  }
}

for (const [label, builds] of settings) {
  const withV1 = builds.filter((b) => b.calls.some((c) => c.in === "v1"));
  const ordered = withV1.filter((b) => {
    const calls = [...b.calls].sort((x, y) => x.start - y.start);
    const firstV2 = calls.findIndex((c) => c.in === "v2");
    return calls[0].in === "v1" && firstV2 > 0 && Number(calls[firstV2 - 1].end) <= Number(calls[firstV2].start);
  });
  const samePid = withV1.filter((b) => new Set(b.calls.map((c) => c.pid)).size === 1);
  const staleOut = builds.filter((b) => {
    const last = [...b.calls].sort((x, y) => x.start - y.start).at(-1);
    return last?.out === "v1";
  });
  const callCounts = [...new Set(builds.map((b) => b.calls.length))].sort().join("/");
  console.log(`${label}`);
  console.log(`  warm builds:                                   ${builds.length}`);
  console.log(`  calls per warm build:                          ${callCounts}`);
  console.log(`  builds where a call got the v1 stylesheet:     ${withV1.length}`);
  console.log(`    v1 call finished before the v2 call started: ${ordered.length}`);
  console.log(`    all calls in one worker process:            ${samePid.length}`);
  console.log(`  builds whose last call emitted v1:             ${staleOut.length}`);
}
