import path from "node:path";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker image.
  output: "standalone",
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@aevify/shared"],
  poweredByHeader: false,
  // Docs pages (/docs) are written in MDX.
  pageExtensions: ["ts", "tsx", "md", "mdx"],
};

const withMDX = createMDX({
  // Plugins by name (required by Turbopack): tables, and heading IDs for #anchor links.
  options: { remarkPlugins: ["remark-gfm"], rehypePlugins: ["rehype-slug"] },
});

export default withMDX(nextConfig);
