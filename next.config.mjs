import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',

  // Pin the workspace root. Without it Turbopack walks up looking for a lockfile and can find
  // an unrelated one outside the repository, then warns and infers the wrong root.
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url)),
  },

  // No webpack overrides: pdfjs-dist stopped reaching for the Node-only `canvas` package (it
  // was aliased away here for v3), and the pdf.js worker is served as a static file from
  // public/pdf.worker.min.js — see scripts/copy-pdf-worker.mjs. This matters more than it
  // used to: from Next 16 `next build` uses Turbopack, and a project that defines a webpack
  // config fails the build outright rather than silently ignoring it.
};

export default nextConfig;
