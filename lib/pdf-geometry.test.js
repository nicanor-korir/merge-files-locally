import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH, fitPageToA4, fitScale, fitToA4Box } from './pdf-geometry.js';
import { LINK_RECT, makePdf } from './__fixtures__/pdfs.js';

// Load a fixture and return its first page, copied into a fresh document exactly the way
// the merge path does — transforms behave differently on copied pages, so test them there.
async function copiedPage(bytes) {
  const source = await PDFDocument.load(bytes);
  const merged = await PDFDocument.create();
  const [page] = await merged.copyPages(source, [0]);
  merged.addPage(page);
  return { page, merged };
}

function rectOf(page) {
  return page.node
    .Annots()
    .lookup(0)
    .lookup(PDFName.of('Rect'))
    .asArray()
    .map((n) => n.asNumber());
}

describe('fitScale', () => {
  it('never enlarges a page smaller than A4', () => {
    expect(fitScale(300, 400)).toBe(1);
    expect(fitScale(A4_WIDTH - 100, A4_HEIGHT - 100)).toBe(1);
  });

  it('scales a landscape page down to fit the A4 box', () => {
    const scale = fitScale(842, 595);
    expect(scale).toBeLessThan(1);
    expect(842 * scale).toBeCloseTo(A4_WIDTH, 4);
    expect(595 * scale).toBeLessThanOrEqual(A4_HEIGHT);
  });

  it('fits by the tighter axis', () => {
    // A very tall page is constrained by height, not width.
    expect(fitScale(400, 2000)).toBeCloseTo(A4_HEIGHT / 2000, 6);
  });
});

describe('fitPageToA4', () => {
  it('leaves a small page at its own size on an A4 sheet', async () => {
    const { page } = await copiedPage(await makePdf({ width: 300, height: 400 }));
    fitPageToA4(page);
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(A4_WIDTH, 2);
    expect(height).toBeCloseTo(A4_HEIGHT, 2);
  });

  it('moves a link annotation with the content it belongs to', async () => {
    const { page } = await copiedPage(await makePdf({ width: 300, height: 400, link: true }));
    fitPageToA4(page);

    // Scale is 1 here, so the offsets are hand-checkable: centred horizontally in the
    // 595.28pt sheet (295.28 / 2) and pinned to the top of the 841.89pt sheet (441.89).
    const dx = (A4_WIDTH - 300) / 2;
    const dy = A4_HEIGHT - 400;
    expect(rectOf(page)).toEqual([
      LINK_RECT[0] + dx,
      LINK_RECT[1] + dy,
      LINK_RECT[2] + dx,
      LINK_RECT[3] + dy,
    ]);
  });

  it('scales a link annotation by the same factor as the page', async () => {
    const { page } = await copiedPage(await makePdf({ width: 842, height: 595, link: true }));
    const scale = fitScale(842, 595);
    fitPageToA4(page);

    const rect = rectOf(page);
    // Width and height of the annotation must track the content scale exactly.
    expect(rect[2] - rect[0]).toBeCloseTo((LINK_RECT[2] - LINK_RECT[0]) * scale, 4);
    expect(rect[3] - rect[1]).toBeCloseTo((LINK_RECT[3] - LINK_RECT[1]) * scale, 4);
  });

  it('keeps annotations inside the page box for every rotation', async () => {
    for (const rotate of [0, 90, 180, 270]) {
      const { page } = await copiedPage(await makePdf({ width: 300, height: 400, rotate, link: true }));
      fitPageToA4(page);
      const { width, height } = page.getSize();
      const [x1, y1, x2, y2] = rectOf(page);
      expect(Math.min(x1, x2), `rotation ${rotate}`).toBeGreaterThanOrEqual(0);
      expect(Math.min(y1, y2), `rotation ${rotate}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(x1, x2), `rotation ${rotate}`).toBeLessThanOrEqual(width + 0.01);
      expect(Math.max(y1, y2), `rotation ${rotate}`).toBeLessThanOrEqual(height + 0.01);
    }
  });

  it('gives a rotated page A4 dimensions once the display rotation is applied', async () => {
    const { page } = await copiedPage(await makePdf({ width: 842, height: 595, rotate: 90 }));
    fitPageToA4(page);
    const { width, height } = page.getSize();
    // /Rotate 90 swaps the axes on display, so the *visual* box is (height, width).
    expect(height).toBeCloseTo(A4_WIDTH, 2);
    expect(width).toBeCloseTo(A4_HEIGHT, 2);
  });

  it('does not throw on a degenerate media box', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([0, 0]);
    expect(() => fitPageToA4(page)).not.toThrow();
  });
});

describe('fitToA4Box', () => {
  it('scales an image up to fill the sheet — pixels carry no physical size', () => {
    const { drawW, pageW, pageH } = fitToA4Box(100, 100);
    expect(drawW).toBeGreaterThan(100);
    expect(pageW).toBeCloseTo(A4_WIDTH, 2);
    expect(pageH).toBeCloseTo(A4_HEIGHT, 2);
  });

  it('preserves aspect ratio when scaling down', () => {
    const { drawW, drawH } = fitToA4Box(4000, 3000);
    expect(drawW / drawH).toBeCloseTo(4000 / 3000, 6);
    expect(drawW).toBeLessThanOrEqual(A4_WIDTH + 0.01);
  });
});
