/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  webpack: (config) => {
    // pdfjs-dist pulls in the Node-only `canvas` package for server-side rendering; the
    // browser only needs the built-in Canvas API, so alias it away to keep it out of the
    // bundle. The pdf.js worker is served as a static file from public/pdf.worker.min.js
    // (see scripts/copy-pdf-worker and the `workerSrc` assignment in app/pdf-merger.js).
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
