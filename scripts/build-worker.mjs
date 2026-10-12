import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/index.ts", migrate: "src/server/db/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
