// Development entry point: rebuild the merge worker on change, then run `next dev`.
//
// Next's dev server knows nothing about public/merge-worker.js — it is built by us, not
// bundled by Next — so without this watcher an edit to lib/merge-worker.js (or anything it
// imports, which is most of lib/) would be silently ignored until the next full build. That
// is a bad way to find out your change did nothing.

import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, workerBuildOptions } from './worker-bundle.mjs';

const ctx = await context({
  ...workerBuildOptions,
  plugins: [
    {
      name: 'report',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return; // esbuild already printed them
          console.log('[dev] merge worker rebuilt');
        });
      },
    },
  ],
});

await ctx.watch();
console.log('[dev] watching lib/merge-worker.js and its imports');

const next = spawn(join(ROOT, 'node_modules/.bin/next'), ['dev'], { stdio: 'inherit' });

let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  await ctx.dispose();
  process.exit(code ?? 0);
}

next.on('exit', (code) => shutdown(code));
// Forward the signal so next dev tears down its own server rather than being orphaned.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    next.kill(signal);
  });
}
