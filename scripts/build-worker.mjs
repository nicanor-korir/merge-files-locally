// Bundles the merge worker into public/merge-worker.js.
//
// The worker is built here rather than left to Next's bundler on purpose. `new Worker(new
// URL('./merge-worker.js', import.meta.url))` is bundler magic, and it does not survive
// Turbopack + `output: 'export'`: the emitted chunk expects a runtime bootstrap that a static
// export never loads, and the worker dies with "Missing worker bootstrap config". Building it
// ourselves makes the worker an ordinary static asset on a stable path — it behaves the same
// whichever bundler Next ships next, and the service worker can precache it by name.
//
// It has to run before `next build`, so that public/ is copied into the export.

import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [join(ROOT, 'lib/merge-worker.js')],
  outfile: join(ROOT, 'public/merge-worker.js'),
  bundle: true,
  minify: true,
  // A classic worker: nothing here needs top-level await or dynamic import, and it keeps the
  // asset loadable from any static host without module-worker MIME strictness.
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  legalComments: 'none',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`[build-worker] public/merge-worker.js written (${Math.round(bytes / 1024)} KB)`);
