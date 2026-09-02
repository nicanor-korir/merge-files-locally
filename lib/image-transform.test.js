import { describe, expect, it } from 'vitest';
import { chooseFormat, computeImageDraw, passthroughFormat } from './image-transform.js';
import { qualityOf } from './output-settings.js';

const ORIGINAL = qualityOf('original');
const BALANCED = qualityOf('balanced');
const SMALL = qualityOf('small');

const file = (type) => ({ type });

describe('chooseFormat', () => {
  it('always uses JPEG for the lossy presets', () => {
    expect(chooseFormat(BALANCED, 'image/png')).toBe('jpeg');
    expect(chooseFormat(SMALL, 'image/png')).toBe('jpeg');
  });

  it('keeps PNG sources lossless at the original preset', () => {
    expect(chooseFormat(ORIGINAL, 'image/png')).toBe('png');
  });

  it('keeps photographic sources on JPEG even when lossless', () => {
    // A photo re-encoded as PNG is an enormous file for no visible gain.
    expect(chooseFormat(ORIGINAL, 'image/jpeg')).toBe('jpeg');
    expect(chooseFormat(ORIGINAL, 'image/webp')).toBe('jpeg');
  });
});

describe('passthroughFormat', () => {
  const untouched = { preset: ORIGINAL, rotation: 0, crop: null, forceCanvas: false };

  it('passes an untouched image through at the original preset', () => {
    expect(passthroughFormat(file('image/jpeg'), untouched)).toBe('jpeg');
    expect(passthroughFormat(file('image/png'), untouched)).toBe('png');
  });

  it('never passes through at a lossy preset, which exists to re-encode', () => {
    expect(passthroughFormat(file('image/jpeg'), { ...untouched, preset: BALANCED })).toBeNull();
  });

  it('never passes through a transformed image', () => {
    expect(passthroughFormat(file('image/jpeg'), { ...untouched, rotation: 90 })).toBeNull();
    expect(
      passthroughFormat(file('image/jpeg'), {
        ...untouched,
        crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
      }),
    ).toBeNull();
  });

  it('treats a full-page crop as no transform at all', () => {
    expect(
      passthroughFormat(file('image/png'), {
        ...untouched,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBe('png');
  });

  it('honours forceCanvas, which is how the embed retry re-encodes', () => {
    expect(passthroughFormat(file('image/jpeg'), { ...untouched, forceCanvas: true })).toBeNull();
  });

  it('refuses formats a PDF cannot embed directly', () => {
    // WebP has no PDF equivalent, so it always has to go through a canvas.
    expect(passthroughFormat(file('image/webp'), untouched)).toBeNull();
    expect(passthroughFormat(file(''), untouched)).toBeNull();
  });
});

describe('computeImageDraw', () => {
  it('leaves an untransformed image alone at the original preset', () => {
    const plan = computeImageDraw(800, 600, { preset: ORIGINAL });
    expect(plan).toMatchObject({
      angle: 0,
      rotW: 800,
      rotH: 600,
      outW: 800,
      outH: 600,
      box: { x: 0, y: 0, width: 800, height: 600 },
    });
  });

  it('swaps the bounds on a quarter turn', () => {
    for (const angle of [90, 270]) {
      const plan = computeImageDraw(800, 600, { rotation: angle, preset: ORIGINAL });
      expect(plan.rotW, `rotation ${angle}`).toBe(600);
      expect(plan.rotH, `rotation ${angle}`).toBe(800);
    }
  });

  it('leaves the bounds alone at a half turn', () => {
    const plan = computeImageDraw(800, 600, { rotation: 180, preset: ORIGINAL });
    expect([plan.rotW, plan.rotH]).toEqual([800, 600]);
  });

  it('indexes the crop into the rotated bounds, not the original', () => {
    const plan = computeImageDraw(800, 600, {
      rotation: 90,
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
      preset: ORIGINAL,
    });
    // Rotated bounds are 600x800, so half of each is 300x400.
    expect(plan.box).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it('caps the output at the preset dimension, preserving aspect', () => {
    const plan = computeImageDraw(4000, 3000, { preset: BALANCED });
    expect(Math.max(plan.outW, plan.outH)).toBe(BALANCED.maxDimension);
    expect(plan.outW / plan.outH).toBeCloseTo(4000 / 3000, 3);
    // The source rectangle is untouched by the cap; only the destination shrinks.
    expect(plan.box.width).toBe(4000);
  });

  it('does not cap at the original preset', () => {
    const plan = computeImageDraw(9000, 200, { preset: ORIGINAL });
    expect(plan.outW).toBe(9000);
  });

  it('caps after cropping, so the crop sets what "too large" means', () => {
    const plan = computeImageDraw(4000, 4000, {
      crop: { x: 0, y: 0, width: 0.25, height: 0.25 },
      preset: BALANCED,
    });
    // The crop is 1000x1000, already under the 2000 cap, so nothing is scaled down.
    expect(plan.box.width).toBe(1000);
    expect(plan.outW).toBe(1000);
  });

  it('never produces a zero-size output', () => {
    const plan = computeImageDraw(10, 10, {
      crop: { x: 0, y: 0, width: 0.001, height: 0.001 },
      preset: SMALL,
    });
    expect(plan.outW).toBeGreaterThanOrEqual(1);
    expect(plan.outH).toBeGreaterThanOrEqual(1);
    expect(plan.box.width).toBeGreaterThanOrEqual(1);
  });
});
