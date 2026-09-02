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
import { workerBuildOptions } from './worker-bundle.mjs';

const result = await build({ ...workerBuildOptions, metafile: true });
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`[build-worker] public/merge-worker.js written (${Math.round(bytes / 1024)} KB)`);
