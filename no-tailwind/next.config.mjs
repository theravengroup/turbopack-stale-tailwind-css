/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["repro-stateful-plugin/loader.cjs"], as: "*.css" },
    },
  },
};

export default nextConfig;
