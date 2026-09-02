/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // No webpack overrides needed: pdfjs-dist stopped reaching for the Node-only `canvas`
  // package (it was aliased away here for v3), and the pdf.js worker is served as a static
  // file from public/pdf.worker.min.js — see scripts/copy-pdf-worker.mjs.
};

export default nextConfig;
