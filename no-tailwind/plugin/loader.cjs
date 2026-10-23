// webpack loader, loaded through turbopack.rules in next.config.mjs (`./repro.sh loader`).
const { transform } = require("./core.cjs");

module.exports = function (source) {
  return transform({
    via: "loader",
    file: this.resourcePath,
    source,
    addDependency: (dep) => this.addDependency(dep),
  });
};
