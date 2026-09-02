import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH } from './pdf-geometry.js';
import {
  describeSkipped,
  MergeCancelled,
  mergeDocuments,
  SKIP_EMPTY,
  SKIP_ENCRYPTED,
  SKIP_UNREADABLE,
} from './merge.js';
import {
  asSource,
  LINK_RECT,
  makeCorruptPdf,
  makeEmptyPdf,
  makeEncryptedPdf,
  makeFormPdf,
  makePdf,
  pagesOf,
} from './__fixtures__/pdfs.js';

// Copied out of the Buffer: readFileSync hands back a view into a pooled ArrayBuffer, and
// pdf-lib reads from byte 0 of the underlying buffer.
const PIXEL_JPEG = new Uint8Array(readFileSync(new URL('./__fixtures__/pixel.jpg', import.meta.url)));
// Stands in for the browser canvas round-trip, which needs a DOM.
const compressImage = () => Promise.resolve(PIXEL_JPEG);

// updateMetadata: false — load() otherwise stamps pdf-lib's own Producer over whatever the
// file actually carries, which would mask the metadata assertion below.
const reload = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });

/** Merge every page of each source, in source order — the default arrangement. */
function mergeAll(sources, counts = []) {
  const pages = sources.flatMap((s, i) => pagesOf(s, counts[i] ?? 1));
  return mergeDocuments(pages, { sources, compressImage });
}

const rectOf = (page, idx = 0) =>
  page.node
    .Annots()
    .lookup(idx)
    .lookup(PDFName.of('Rect'))
    .asArray()
    .map((n) => n.asNumber());

describe('mergeDocuments', () => {
  it('concatenates pages in the order given', async () => {
    const a = asSource(await makePdf({ pages: 2 }), 'a.pdf');
    const b = asSource(await makePdf({ pages: 3 }), 'b.pdf');
    const out = await mergeAll([a, b], [2, 3]);
    expect(out.skipped).toEqual([]);
    expect((await reload(out.bytes)).getPageCount()).toBe(5);
  });

  it('emits pages in page order, not source order', async () => {
    const a = asSource(await makePdf({ pages: 2 }), 'a.pdf');
    const b = asSource(await makePdf({ pages: 2 }), 'b.pdf');
    // Interleave: b1, a2, b2, a1 — an arrangement no file-level ordering could express.
    const [a1, a2] = pagesOf(a, 2);
    const [b1, b2] = pagesOf(b, 2);
    const out = await mergeDocuments([b1, a2, b2, a1], { sources: [a, b], compressImage });
    expect((await reload(out.bytes)).getPageCount()).toBe(4);
  });

  it('drops pages the user removed', async () => {
    const a = asSource(await makePdf({ pages: 5 }), 'a.pdf');
    const kept = pagesOf(a, 5).filter((_, i) => i !== 1 && i !== 3);
    const out = await mergeDocuments(kept, { sources: [a], compressImage });
    expect((await reload(out.bytes)).getPageCount()).toBe(3);
  });

  it('parses each source once however many pages it contributes', async () => {
    const bytes = await makePdf({ pages: 6 });
    const source = asSource(bytes, 'a.pdf');
    const arrayBuffer = vi.spyOn(source.file, 'arrayBuffer');
    await mergeDocuments(pagesOf(source, 6), { sources: [source], compressImage });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('fits every page to A4', async () => {
    const small = asSource(await makePdf({ width: 300, height: 400 }), 'small.pdf');
    const wide = asSource(await makePdf({ width: 842, height: 595 }), 'wide.pdf');
    const out = await mergeAll([small, wide]);
    for (const page of (await reload(out.bytes)).getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4_WIDTH, 1);
      expect(page.getHeight()).toBeCloseTo(A4_HEIGHT, 1);
    }
  });

  it('carries a link annotation along with the content it points at', async () => {
    const linked = asSource(await makePdf({ width: 300, height: 400, link: true }), 'linked.pdf');
    const out = await mergeAll([linked]);
    const page = (await reload(out.bytes)).getPage(0);
    const rect = rectOf(page);

    // The regression this guards: scaleContent/translateContent used to move the visible
    // content while leaving the annotation at its authored coordinates.
    expect(rect).not.toEqual(LINK_RECT);
    expect(rect[0]).toBeGreaterThanOrEqual(0);
    expect(rect[2]).toBeLessThanOrEqual(page.getWidth());
    expect(rect[3]).toBeLessThanOrEqual(page.getHeight());
  });

  it('flattens form fields instead of emitting dead, misplaced widgets', async () => {
    const out = await mergeAll([asSource(await makeFormPdf(), 'form.pdf')]);
    const doc = await reload(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    // Nothing interactive survives, and no orphan widget is left behind either.
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('skips a password-protected PDF by name and reason', async () => {
    const locked = asSource(await makeEncryptedPdf(), 'locked.pdf');
    const fine = asSource(await makePdf({ pages: 1 }), 'fine.pdf');
    const out = await mergeAll([locked, fine]);
    expect(out.skipped).toEqual([{ name: 'locked.pdf', reason: SKIP_ENCRYPTED }]);
    // The rest of the batch still merges — one bad file never discards the others.
    expect((await reload(out.bytes)).getPageCount()).toBe(1);
  });

  it('skips unreadable bytes without failing the batch', async () => {
    const broken = asSource(makeCorruptPdf(), 'broken.pdf');
    const fine = asSource(await makePdf({ pages: 2 }), 'fine.pdf');
    const out = await mergeAll([broken, fine], [1, 2]);
    expect(out.skipped).toEqual([{ name: 'broken.pdf', reason: SKIP_UNREADABLE }]);
    expect((await reload(out.bytes)).getPageCount()).toBe(2);
  });

  it('skips a PDF that contains no pages', async () => {
    const blank = asSource(await makeEmptyPdf(), 'blank.pdf');
    const fine = asSource(await makePdf({ pages: 1 }), 'fine.pdf');
    const out = await mergeAll([blank, fine]);
    expect(out.skipped).toEqual([{ name: 'blank.pdf', reason: SKIP_EMPTY }]);
  });

  it('throws only when nothing at all could be merged', async () => {
    await expect(mergeAll([asSource(makeCorruptPdf(), 'broken.pdf')])).rejects.toThrow(
      /None of the files/,
    );
  });

  it('places an image on its own A4 page', async () => {
    const out = await mergeAll([asSource(PIXEL_JPEG, 'photo.jpg', 'image/jpeg')]);
    const doc = await reload(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4_WIDTH, 1);
  });

  it('reports progress as it builds', async () => {
    const source = asSource(await makePdf(), 'a.pdf');
    const onProgress = vi.fn();
    await mergeDocuments(pagesOf(source, 1), { sources: [source], compressImage, onProgress });
    expect(onProgress).toHaveBeenCalledWith('Reading a.pdf');
    expect(onProgress).toHaveBeenCalledWith('Building page 1 of 1');
  });

  it('writes its own metadata rather than the library default', async () => {
    const source = asSource(await makePdf(), 'a.pdf');
    const out = await mergeDocuments(pagesOf(source, 1), {
      sources: [source],
      compressImage,
      title: 'a-merged.pdf',
    });
    const doc = await reload(out.bytes);
    expect(doc.getProducer()).toBe('Merge Files Locally');
    expect(doc.getProducer()).not.toMatch(/pdf-lib/);
    expect(doc.getTitle()).toBe('a-merged.pdf');
  });
});

describe('per-page transforms', () => {
  it('adds the page rotation on top of the source /Rotate', async () => {
    const source = asSource(await makePdf({ width: 300, height: 400, rotate: 90 }), 'a.pdf');
    const [page] = pagesOf(source, 1, { rotation: 90 });
    const out = await mergeDocuments([page], { sources: [source], compressImage });
    expect((await reload(out.bytes)).getPage(0).getRotation().angle).toBe(180);
  });

  it('normalizes a rotation that wraps past 360', async () => {
    const source = asSource(await makePdf({ rotate: 270 }), 'a.pdf');
    const [page] = pagesOf(source, 1, { rotation: 180 });
    const out = await mergeDocuments([page], { sources: [source], compressImage });
    expect((await reload(out.bytes)).getPage(0).getRotation().angle).toBe(90);
  });

  it('leaves an untouched page identical to no transform at all', async () => {
    const source = asSource(await makePdf({ width: 300, height: 400 }), 'a.pdf');
    const [page] = pagesOf(source, 1, { crop: { x: 0, y: 0, width: 1, height: 1 } });
    const out = await mergeDocuments([page], { sources: [source], compressImage });
    const doc = await reload(out.bytes);
    // A full-page crop is a no-op, so the page still fills an A4 sheet.
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4_WIDTH, 1);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });

  it('crops a page down and still fits the result to A4', async () => {
    const source = asSource(await makePdf({ width: 400, height: 400 }), 'a.pdf');
    const [page] = pagesOf(source, 1, { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    const out = await mergeDocuments([page], { sources: [source], compressImage });
    const result = (await reload(out.bytes)).getPage(0);
    // The cropped region is 200x200pt — square, under A4, so it is not enlarged and sits on
    // a full sheet.
    expect(result.getWidth()).toBeCloseTo(A4_WIDTH, 1);
    expect(result.getHeight()).toBeCloseTo(A4_HEIGHT, 1);
  });

  it('moves annotations with a crop', async () => {
    const source = asSource(await makePdf({ width: 400, height: 400, link: true }), 'a.pdf');
    const [page] = pagesOf(source, 1, { crop: { x: 0, y: 0, width: 0.6, height: 0.6 } });
    const out = await mergeDocuments([page], { sources: [source], compressImage });
    const result = (await reload(out.bytes)).getPage(0);
    const rect = rectOf(result);
    expect(rect).not.toEqual(LINK_RECT);
    expect(Math.min(rect[0], rect[2])).toBeGreaterThanOrEqual(0);
  });
});

describe('bookmarks', () => {
  it('adds one outline entry per source document', async () => {
    const a = asSource(await makePdf({ pages: 2 }), 'chapter-one.pdf');
    const b = asSource(await makePdf({ pages: 2 }), 'chapter-two.pdf');
    const out = await mergeAll([a, b], [2, 2]);
    const doc = await reload(out.bytes);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines).toBeDefined();
    expect(outlines.lookup(PDFName.of('Count')).asNumber()).toBe(2);
    expect(outlines.lookup(PDFName.of('First')).lookup(PDFName.of('Title')).decodeText()).toBe(
      'chapter-one.pdf',
    );
  });

  it('does not add an outline for a single source', async () => {
    const out = await mergeAll([asSource(await makePdf({ pages: 3 }), 'only.pdf')], [3]);
    const doc = await reload(out.bytes);
    expect(doc.catalog.lookup(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('bookmarks each run of a source that appears more than once', async () => {
    const a = asSource(await makePdf({ pages: 2 }), 'a.pdf');
    const b = asSource(await makePdf({ pages: 1 }), 'b.pdf');
    const [a1, a2] = pagesOf(a, 2);
    const [b1] = pagesOf(b, 1);
    // a, b, a — the second run of a gets its own entry.
    const out = await mergeDocuments([a1, b1, a2], { sources: [a, b], compressImage });
    const doc = await reload(out.bytes);
    expect(doc.catalog.lookup(PDFName.of('Outlines')).lookup(PDFName.of('Count')).asNumber()).toBe(3);
  });
});

describe('cancellation', () => {
  it('aborts a merge that is already running', async () => {
    const source = asSource(await makePdf({ pages: 40 }), 'big.pdf');
    const controller = new AbortController();
    const promise = mergeDocuments(pagesOf(source, 40), {
      sources: [source],
      compressImage,
      signal: controller.signal,
      onProgress: (msg) => {
        if (msg === 'Building page 6 of 40') controller.abort();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(MergeCancelled);
  });

  it('runs to completion when nothing aborts', async () => {
    const source = asSource(await makePdf({ pages: 12 }), 'a.pdf');
    const out = await mergeDocuments(pagesOf(source, 12), {
      sources: [source],
      compressImage,
      signal: new AbortController().signal,
    });
    expect((await reload(out.bytes)).getPageCount()).toBe(12);
  });
});

describe('describeSkipped', () => {
  it('names each file with its reason', () => {
    expect(
      describeSkipped([
        { name: 'locked.pdf', reason: SKIP_ENCRYPTED },
        { name: 'broken.pdf', reason: SKIP_UNREADABLE },
      ]),
    ).toBe('locked.pdf (password-protected), broken.pdf (unreadable)');
  });
});
