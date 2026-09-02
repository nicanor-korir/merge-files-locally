// Runs the merge off the main thread.
//
// pdf-lib work is synchronous and CPU-bound: on the main thread a large batch freezes the tab,
// and the progress overlay cannot repaint to show it is doing anything. Here it competes with
// nothing. Cancellation is the caller terminating this worker, which is instant and needs no
// cooperation from the merge loop.
//
// User files arrive as structured-cloned File objects. They are read here and never sent
// anywhere — the CSP forbids egress from workers exactly as it does from the page.

import { compressImageInWorker } from './compress-image-worker.js';
import { mergeDocuments } from './merge.js';

self.onmessage = async (event) => {
  const { pages, sources, pageSize, quality, title } = event.data;

  try {
    const { bytes, skipped } = await mergeDocuments(pages, {
      sources,
      pageSize,
      quality,
      title,
      compressImage: compressImageInWorker,
      onProgress: (message) => self.postMessage({ type: 'progress', message }),
    });

    // Transfer rather than copy: the output can be tens of megabytes.
    self.postMessage({ type: 'done', bytes, skipped }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? 'Merge failed' });
  }
};
