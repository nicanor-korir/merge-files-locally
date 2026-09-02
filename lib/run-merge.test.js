import { afterEach, describe, expect, it } from 'vitest';
import { canUseWorker } from './run-merge.js';

const ORIGINAL = {
  Worker: globalThis.Worker,
  OffscreenCanvas: globalThis.OffscreenCanvas,
  createImageBitmap: globalThis.createImageBitmap,
};

function setEnv({ worker, offscreen, bitmap }) {
  globalThis.Worker = worker ? function Worker() {} : undefined;
  globalThis.OffscreenCanvas = offscreen ? function OffscreenCanvas() {} : undefined;
  globalThis.createImageBitmap = bitmap ? () => {} : undefined;
}

afterEach(() => {
  Object.assign(globalThis, ORIGINAL);
});

describe('canUseWorker', () => {
  it('is true only when every piece is present', () => {
    setEnv({ worker: true, offscreen: true, bitmap: true });
    expect(canUseWorker()).toBe(true);
  });

  it('is false without OffscreenCanvas, which is the real gate', () => {
    // Safari only gained OffscreenCanvas in 16.4. Without it there is no canvas inside a
    // worker to re-encode image pages with, so the whole merge has to stay on the main thread.
    setEnv({ worker: true, offscreen: false, bitmap: true });
    expect(canUseWorker()).toBe(false);
  });

  it('is false without Worker or createImageBitmap', () => {
    setEnv({ worker: false, offscreen: true, bitmap: true });
    expect(canUseWorker()).toBe(false);
    setEnv({ worker: true, offscreen: true, bitmap: false });
    expect(canUseWorker()).toBe(false);
  });
});
