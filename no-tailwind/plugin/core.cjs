// A transform with per-file state, standing in for any loader or PostCSS plugin that keeps a
// compiled form of a stylesheet between calls (as @tailwindcss/turbopack 4.3.3 and
// @tailwindcss/postcss before 4.3.3 did).
//
// - It "compiles" the stylesheet once and keeps the result for the life of the worker process,
//   keyed by file path and invalidated only when the file's mtime changes.
// - Like Tailwind, it also reads another file (app/page.jsx) and registers it as a dependency,
//   so a change to that file re-runs the transform.
//
// Every call appends one line to ../plugin.trace: worker pid, start/end time, the stylesheet
// version it was handed, the version it emitted, the page version it read, and whether the
// cached compile was used. Creating ./stateless before a build turns the cache off.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TRACE = path.join(ROOT, "plugin.trace");
const STATELESS = fs.existsSync(path.join(__dirname, "stateless"));
const sheetVersion = (css) => String(css).match(/--repro-stylesheet:\s*"(v\d)"/)?.[1] ?? "?";

const compiled = new Map(); // absolute path -> { mtimeMs, css }

function transform({ via, file, source, addDependency }) {
  const start = Date.now();
  const { mtimeMs } = fs.statSync(file);
  let entry = STATELESS ? undefined : compiled.get(file);
  const hit = entry !== undefined && entry.mtimeMs === mtimeMs;
  if (!hit) {
    entry = { mtimeMs, css: String(source) };
    compiled.set(file, entry);
  }

  const page = path.join(path.dirname(file), "page.jsx");
  addDependency(page);
  const pageVersion = fs.readFileSync(page, "utf8").match(/data-version="(v\d)"/)?.[1] ?? "?";

  const output = `${entry.css}\n.repro-page { --repro-page: "${pageVersion}"; }\n`;
  fs.appendFileSync(
    TRACE,
    `via=${via} pid=${process.pid} start=${start} end=${Date.now()} ` +
      `in=${sheetVersion(source)} out=${sheetVersion(output)} page=${pageVersion} ` +
      `cache=${STATELESS ? "off" : hit ? "hit" : "miss"}\n`,
  );
  return output;
}

module.exports = { ROOT, transform };
