import { defineConfig } from "tsup";

/**
 * Published build: ESM + CommonJS with bundled type declarations. The shared code it uses
 * (webhook verification, payment types) is imported by relative path from packages/shared,
 * so it's bundled in and the package has no runtime dependencies.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node20",
  platform: "neutral",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
