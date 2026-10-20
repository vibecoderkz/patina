import { build } from "esbuild";

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/patina.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
