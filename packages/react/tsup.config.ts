import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
  // Client components (works in the Next.js App Router without a wrapper).
  banner: { js: '"use client";' },
});
