// Copies the pdf.js worker that ships with the installed pdfjs-dist into public/, so the
// served /pdf.worker.min.js always matches the pinned library version. pdf.js throws
// "The API version X does not match the Worker version Y" if these drift — running this on
// postinstall and prebuild prevents that. Keep the source path in sync with the import in
// app/pdf-merger.js (`pdfjs-dist/legacy/build/pdf.js`).
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const SRC = resolve(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js');
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
