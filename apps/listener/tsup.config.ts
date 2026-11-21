import { defineConfig } from "tsup";

/**
 * One self-contained file (dist/main.js) with every dependency bundled, so the production
 * image needs no node_modules. The banner gives bundled CommonJS code (the MongoDB driver)
 * a working `require` for Node built-ins inside the ES module.
 */
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __aevifyCreateRequire } from 'node:module'; const require = __aevifyCreateRequire(import.meta.url);",
  },
});
