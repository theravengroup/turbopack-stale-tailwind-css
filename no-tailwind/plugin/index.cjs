// PostCSS plugin, loaded through postcss.config.mjs (`./repro.sh postcss`).
const path = require("node:path");
const { ROOT, transform } = require("./core.cjs");

module.exports = () => ({
  postcssPlugin: "repro-stateful",
  Once(root, { result, parse }) {
    const from = result.opts.from;
    if (!from || !from.endsWith("globals.css")) return;
    const file = path.resolve(ROOT, from);
    const output = transform({
      via: "postcss",
      file,
      source: root.toString(),
      addDependency: (dep) =>
        result.messages.push({ type: "dependency", plugin: "repro-stateful", file: dep, parent: file }),
    });
    root.removeAll();
    root.append(parse(output, { from }).nodes);
  },
});
module.exports.postcss = true;
