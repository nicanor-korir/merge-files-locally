// Single source of truth for how the merge worker is bundled, shared by the one-shot build
// (build-worker.mjs) and the dev watcher (dev.mjs) so the two cannot drift.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTFILE = join(ROOT, 'public/merge-worker.js');

export const workerBuildOptions = {
  entryPoints: [join(ROOT, 'lib/merge-worker.js')],
  outfile: OUTFILE,
  bundle: true,
  minify: true,
  // A classic worker: nothing here needs top-level await or dynamic import, and it keeps the
  // asset loadable from any static host without module-worker MIME strictness.
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  legalComments: 'none',
};
