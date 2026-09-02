// Copies the pdf.js worker that ships with the installed pdfjs-dist into public/, so the
// served /pdf.worker.min.js always matches the pinned library version. pdf.js throws
// "The API version X does not match the Worker version Y" if these drift — running this on
// postinstall and prebuild prevents that. Keep the source path in sync with the import in
// app/pdf-merger.js (`pdfjs-dist/legacy/build/pdf.mjs`).
//
// The source is ESM (.mjs) from pdf.js 4 onward and is loaded as a module worker, but the
// destination deliberately keeps the .js extension: the extension is irrelevant to a module
// worker, while `.js` is the one every static host reliably serves as text/javascript. A host
// that does not know `.mjs` would serve it as octet-stream and the worker would refuse to
// load — this app is meant to run from any static server.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const SRC = resolve(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const DEST = resolve(root, 'public/pdf.worker.min.js');

try {
  await access(SRC);
} catch {
  console.warn(`[copy-pdf-worker] source not found (${SRC}); skipping. Run npm install first.`);
  process.exit(0);
}

await mkdir(dirname(DEST), { recursive: true });
await copyFile(SRC, DEST);
console.log('[copy-pdf-worker] public/pdf.worker.min.js updated from pdfjs-dist.');
