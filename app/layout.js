import './globals.css';

export const metadata = {
  title: 'PDF Merger — Local & Private',
  description: 'Merge PDFs and images into one PDF. Everything runs locally in your browser.',
};

// Content-Security-Policy delivered as a <meta> so the no-egress guarantee is enforced even
// when the static export is hosted somewhere without HTTP-header support (e.g. file:// or a
// plain static server). When served by Vercel, vercel.json sets the same policy as a real
// header (stronger — it can also carry frame-ancestors, which <meta> ignores).
//
// connect-src 'self' is the load-bearing directive: it blocks any fetch/XHR/beacon to an
// external host, so user files physically cannot be uploaded or exfiltrated — this is what
// enforces the privacy promise. 'wasm-unsafe-eval' + blob: worker-src cover the pdf.js
// worker. 'unsafe-inline' is required for both script and style: Next.js static export
// inlines its hydration bootstrap as inline <script> tags, and styled-jsx / inline styles
// need inline CSS. Nonces/hashes aren't viable for a server-less static export. The script
// relaxation is an accepted tradeoff: even if inline script ran, connect-src still makes
// egress impossible.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>{children}</body>
    </html>
  );
}
