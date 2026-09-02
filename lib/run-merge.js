import { MergeCancelled } from './merge-cancelled.js';

// Raised when the worker itself never gets going — a bundling problem, a blocked script, an
// environment that cannot start one. Distinct from an error the merge reports about the files,
// which must not trigger a retry.
class WorkerUnavailable extends Error {}

/**
 * Whether the merge can run off the main thread.
 *
 * OffscreenCanvas is the deciding factor, not Worker: image pages have to be re-encoded, and
 * without it there is no canvas inside a worker to do that with. Safari only gained it in
 * 16.4, so the main-thread path is a real fallback rather than dead code.
 */
export function canUseWorker() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

/**
 * Merge in a worker when the browser allows it, otherwise on the main thread.
 *
 * Both paths share one contract: progress callbacks, a cancel function, and a promise that
 * resolves with `{ bytes, skipped }` or rejects with MergeCancelled.
 *
 * @returns {{ promise: Promise<{bytes: Uint8Array, skipped: Array}>, cancel: () => void }}
 */
export function runMerge(options) {
  if (!canUseWorker()) return runOnMainThread(options);

  let active = runInWorker(options);
  let cancelled = false;

  // A worker that cannot start must not cost the user their merge — fall back and finish the
  // job on the main thread. Only startup failures retry; an error the merge itself reported
  // would fail exactly the same way a second time.
  const promise = active.promise.catch((error) => {
    if (cancelled || !(error instanceof WorkerUnavailable)) throw error;
    console.warn('Merge worker unavailable; falling back to the main thread.', error);
    active = runOnMainThread(options);
    return active.promise;
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      active.cancel();
    },
  };
}

function runInWorker({ pages, sources, pageSize, quality, title, onProgress }) {
  // The URL form is what lets the bundler emit the worker as its own chunk; a bare string
  // would be resolved at runtime against a path that does not exist in the export.
  // A plain static asset built by scripts/build-worker.mjs, resolved against the document so
  // it also works when the app is hosted under a sub-path.
  const worker = new Worker(new URL('merge-worker.js', document.baseURI));
  let settled = false;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.message);
        return;
      }
      settled = true;
      worker.terminate();
      if (data.type === 'done') resolve({ bytes: data.bytes, skipped: data.skipped });
      else reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new WorkerUnavailable(event.message || 'Merge worker failed to start'));
    };

    worker.postMessage({ pages, sources, pageSize, quality, title });
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      // Terminating is the cancellation: it stops mid-page, with no cooperation needed from
      // the merge loop and nothing left running in the background. It also means no further
      // messages arrive, so the promise has to be settled here or it would hang forever.
      worker.terminate();
      rejectPromise(new MergeCancelled());
    },
  };
}

function runOnMainThread({ pages, sources, pageSize, quality, title, onProgress }) {
  const controller = new AbortController();

  // Loaded on demand so the main bundle does not carry pdf-lib and the image encoder for a
  // path most browsers never take.
  const promise = (async () => {
    const [{ mergeDocuments }, { compressImage }] = await Promise.all([
      import('./merge.js'),
      import('./compress-image.js'),
    ]);
    return mergeDocuments(pages, {
      sources,
      pageSize,
      quality,
      title,
      compressImage,
      onProgress,
      signal: controller.signal,
    });
  })();

  return { promise, cancel: () => controller.abort() };
}

export { MergeCancelled };
