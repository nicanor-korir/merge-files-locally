import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { A4_HEIGHT, A4_WIDTH } from './pdf-geometry.js';
import { describeSkipped, mergeDocuments, SKIP_EMPTY, SKIP_ENCRYPTED, SKIP_UNREADABLE } from './merge.js';
import {
  asEntry,
  LINK_RECT,
  makeCorruptPdf,
  makeEmptyPdf,
  makeEncryptedPdf,
  makeFormPdf,
  makePdf,
} from './__fixtures__/pdfs.js';

// Copied out of the Buffer: readFileSync hands back a view into a pooled ArrayBuffer, and
// pdf-lib reads from byte 0 of the underlying buffer.
const PIXEL_JPEG = new Uint8Array(readFileSync(new URL('./__fixtures__/pixel.jpg', import.meta.url)));
// Stands in for the browser canvas round-trip, which needs a DOM.
const compressImage = () => Promise.resolve(PIXEL_JPEG);

const merge = (entries) => mergeDocuments(entries, { compressImage });
// updateMetadata: false — load() otherwise stamps pdf-lib's own Producer over whatever the
// file actually carries, which would mask the metadata assertion below.
const reload = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });

describe('mergeDocuments', () => {
  it('concatenates pages in the order given', async () => {
    const out = await merge([
      asEntry(await makePdf({ pages: 2 }), 'a.pdf'),
      asEntry(await makePdf({ pages: 3 }), 'b.pdf'),
    ]);
    expect(out.skipped).toEqual([]);
    expect((await reload(out.bytes)).getPageCount()).toBe(5);
  });

  it('fits every page to A4', async () => {
    const out = await merge([
      asEntry(await makePdf({ width: 300, height: 400 }), 'small.pdf'),
      asEntry(await makePdf({ width: 842, height: 595 }), 'wide.pdf'),
    ]);
    const doc = await reload(out.bytes);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4_WIDTH, 1);
      expect(page.getHeight()).toBeCloseTo(A4_HEIGHT, 1);
    }
  });

  it('carries a link annotation along with the content it points at', async () => {
    const out = await merge([asEntry(await makePdf({ width: 300, height: 400, link: true }), 'linked.pdf')]);
    const page = (await reload(out.bytes)).getPage(0);
    const rect = page.node
      .Annots()
      .lookup(0)
      .lookup(PDFName.of('Rect'))
      .asArray()
      .map((n) => n.asNumber());

    // The regression this guards: scaleContent/translateContent used to move the visible
    // content while leaving the annotation at its authored coordinates.
    expect(rect).not.toEqual(LINK_RECT);
    expect(rect[0]).toBeGreaterThanOrEqual(0);
    expect(rect[2]).toBeLessThanOrEqual(page.getWidth());
    expect(rect[3]).toBeLessThanOrEqual(page.getHeight());
  });

  it('flattens form fields instead of emitting dead, misplaced widgets', async () => {
    const out = await merge([asEntry(await makeFormPdf(), 'form.pdf')]);
    const doc = await reload(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    // Nothing interactive survives, and no orphan widget is left behind either.
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('skips a password-protected PDF by name and reason', async () => {
    const out = await merge([
      asEntry(await makeEncryptedPdf(), 'locked.pdf'),
      asEntry(await makePdf({ pages: 1 }), 'fine.pdf'),
    ]);
    expect(out.skipped).toEqual([{ name: 'locked.pdf', reason: SKIP_ENCRYPTED }]);
    // The rest of the batch still merges — one bad file never discards the others.
    expect((await reload(out.bytes)).getPageCount()).toBe(1);
  });

  it('skips unreadable bytes without failing the batch', async () => {
    const out = await merge([
      asEntry(makeCorruptPdf(), 'broken.pdf'),
      asEntry(await makePdf({ pages: 2 }), 'fine.pdf'),
    ]);
    expect(out.skipped).toEqual([{ name: 'broken.pdf', reason: SKIP_UNREADABLE }]);
    expect((await reload(out.bytes)).getPageCount()).toBe(2);
  });

  it('skips a PDF that contains no pages', async () => {
    const out = await merge([
      asEntry(await makeEmptyPdf(), 'blank.pdf'),
      asEntry(await makePdf({ pages: 1 }), 'fine.pdf'),
    ]);
    expect(out.skipped).toEqual([{ name: 'blank.pdf', reason: SKIP_EMPTY }]);
  });

  it('throws only when nothing at all could be merged', async () => {
    await expect(merge([asEntry(makeCorruptPdf(), 'broken.pdf')])).rejects.toThrow(/None of the files/);
  });

  it('places an image on its own A4 page', async () => {
    const out = await merge([asEntry(PIXEL_JPEG, 'photo.jpg', 'image/jpeg')]);
    const doc = await reload(out.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4_WIDTH, 1);
  });

  it('reports progress for each file', async () => {
    const onProgress = vi.fn();
    await mergeDocuments([asEntry(await makePdf(), 'a.pdf')], { compressImage, onProgress });
    expect(onProgress).toHaveBeenCalledWith('Processing 1 of 1: a.pdf');
  });

  it('writes its own metadata rather than the library default', async () => {
    const out = await mergeDocuments([asEntry(await makePdf(), 'a.pdf')], {
      compressImage,
      title: 'a-merged.pdf',
    });
    const doc = await reload(out.bytes);
    expect(doc.getProducer()).toBe('Merge Files Locally');
    expect(doc.getProducer()).not.toMatch(/pdf-lib/);
    expect(doc.getTitle()).toBe('a-merged.pdf');
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
