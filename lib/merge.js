import { PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { applyPageTransform, fitPageToA4, fitToA4Box } from './pdf-geometry.js';

export const SKIP_ENCRYPTED = 'password-protected';
export const SKIP_EMPTY = 'no pages';
export const SKIP_UNREADABLE = 'unreadable';

export class MergeCancelled extends Error {
  constructor() {
    super('Merge cancelled');
    this.name = 'MergeCancelled';
  }
}

// Carries a user-facing reason for skipping a file, as opposed to an unexpected crash.
class SkipFile extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// pdf-lib's flatten() bakes each widget's appearance into the page content stream and drops
// the field, but leaves the widget's entry in the page's /Annots. Once copied that entry
// dangles, so viewers either draw a dead box over the flattened pixels or report the file as
// damaged. Drop the widgets — and any reference that no longer resolves — after flattening.
function removeFlattenedWidgets(page) {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let idx = annots.size() - 1; idx >= 0; idx--) {
    const annot = annots.lookup(idx);
    const isWidget =
      annot instanceof PDFDict && annot.get(PDFName.of('Subtype'))?.toString() === '/Widget';
    if (!annot || isWidget) annots.remove(idx);
  }
}

/**
 * Copy every page a source contributes, in one pass.
 *
 * One copyPages() call per source rather than per page: each call builds its own copier, so
 * calling it repeatedly duplicates shared resources (fonts, embedded images) into the output
 * once per page instead of once per document.
 */
async function copyFromSource(merged, arrayBuffer, indices) {
  // ignoreEncryption lets pdf-lib *open* an encrypted file without decrypting it. The page
  // content streams stay encrypted, so copying them yields unreadable pages instead of an
  // error — the file would sail past a try/catch and land silently corrupt in the output.
  // Load permissively so the flag is readable, then refuse explicitly.
  const source = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (source.isEncrypted) throw new SkipFile(SKIP_ENCRYPTED);
  if (source.getPageCount() === 0) throw new SkipFile(SKIP_EMPTY);

  // Widget annotations survive copyPages but the document-level /AcroForm does not, which
  // leaves form fields visible, misplaced and dead. Flattening bakes each field's current
  // appearance into the page content so it scales and moves with everything else. A form
  // that cannot be flattened (fields lacking appearance streams) is not worth failing over.
  try {
    source.getForm().flatten();
    source.getPages().forEach(removeFlattenedWidgets);
  } catch {
    /* no form, or appearances we can't generate — merge the pages as they are */
  }

  const wanted = indices.filter((i) => i < source.getPageCount());
  const copied = await merged.copyPages(source, wanted);
  return new Map(wanted.map((sourceIndex, i) => [sourceIndex, copied[i]]));
}

/**
 * One bookmark per source document, pointing at the first output page it contributed.
 *
 * pdf-lib has no outline API, so the /Outlines tree is built by hand. Titles go in as hex
 * strings (UTF-16BE) so non-ASCII filenames survive.
 */
function addOutline(doc, entries) {
  if (entries.length < 2) return; // a single source needs no navigation tree
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlinesRef = ctx.nextRef();
  const itemRefs = entries.map(() => ctx.nextRef());

  entries.forEach((entry, i) => {
    const item = ctx.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlinesRef,
      Dest: [pages[entry.pageIndex].ref, 'XYZ', null, null, null],
    });
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < entries.length - 1) item.set(PDFName.of('Next'), itemRefs[i + 1]);
    ctx.assign(itemRefs[i], item);
  });

  ctx.assign(
    outlinesRef,
    ctx.obj({
      Type: 'Outlines',
      First: itemRefs[0],
      Last: itemRefs[itemRefs.length - 1],
      Count: entries.length,
    }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

async function appendImage(merged, source, page, compressImage) {
  // embedJpg only accepts baseline JPEG; the canvas round-trip guarantees that, and applies
  // the page's rotation and crop while it is there.
  const jpgBuf = await compressImage(source.file, { rotation: page.rotation, crop: page.crop });
  const image = await merged.embedJpg(jpgBuf);
  const { width: imgW, height: imgH } = image.scale(1);
  const { drawW, drawH, pageW, pageH } = fitToA4Box(imgW, imgH);
  const out = merged.addPage([pageW, pageH]);
  // Centre horizontally; pin to the top of the page.
  out.drawImage(image, { x: (pageW - drawW) / 2, y: pageH - drawH, width: drawW, height: drawH });
}

/**
 * Merge a list of page entries into one A4-fitted PDF.
 *
 * Pages carry only a source reference plus their rotation and crop, so the output order is
 * exactly the order given — pages from different documents may interleave freely.
 *
 * Each source is isolated: a corrupt, encrypted or unreadable one drops all of its pages with
 * a reason rather than discarding the batch. `compressImage` is injected so this module stays
 * free of DOM APIs and can be tested in Node.
 *
 * @param {Array} pages page entries, in output order
 * @param {object} options
 * @param {Array} options.sources `{ fileId, name, type, file }` for every referenced file
 * @param {AbortSignal} [options.signal] abort between pages to cancel a long merge
 * @returns {Promise<{ bytes: Uint8Array, skipped: Array<{name: string, reason: string}> }>}
 */
export async function mergeDocuments(pages, options = {}) {
  const { sources = [], compressImage, onProgress, title, signal } = options;
  const byId = new Map(sources.map((s) => [s.fileId, s]));

  // updateMetadata: false stops pdf-lib stamping its own Producer/Creator and a wall-clock
  // timestamp into the info dict, so the values set below are the only ones the output carries.
  const merged = await PDFDocument.create({ updateMetadata: false });
  const skipped = [];
  const failedFiles = new Map(); // fileId -> reason
  const copiedByFile = new Map(); // fileId -> Map<sourceIndex, PDFPage>
  const bookmarks = [];
  let lastBookmarkedFile = null;

  const checkCancelled = () => {
    if (signal?.aborted) throw new MergeCancelled();
  };

  // Which pages each PDF source needs, in one pass, so every document is parsed exactly once.
  const neededByFile = new Map();
  for (const page of pages) {
    const source = byId.get(page.fileId);
    if (!source || source.type !== 'application/pdf') continue;
    if (!neededByFile.has(page.fileId)) neededByFile.set(page.fileId, new Set());
    neededByFile.get(page.fileId).add(page.sourceIndex);
  }

  for (const [fileId, indices] of neededByFile) {
    checkCancelled();
    const source = byId.get(fileId);
    onProgress?.(`Reading ${source.name}`);
    try {
      const buf = await source.file.arrayBuffer();
      copiedByFile.set(fileId, await copyFromSource(merged, buf, [...indices].sort((a, b) => a - b)));
    } catch (err) {
      if (!(err instanceof SkipFile)) console.error('Skipping file during merge:', source.name, err);
      const reason = err instanceof SkipFile ? err.reason : SKIP_UNREADABLE;
      failedFiles.set(fileId, reason);
      skipped.push({ name: source.name, reason });
    }
  }

  for (let i = 0; i < pages.length; i++) {
    checkCancelled();
    const page = pages[i];
    const source = byId.get(page.fileId);
    if (!source || failedFiles.has(page.fileId)) continue;

    onProgress?.(`Building page ${i + 1} of ${pages.length}`);

    try {
      if (source.type === 'application/pdf') {
        const copied = copiedByFile.get(page.fileId)?.get(page.sourceIndex);
        if (!copied) continue;
        applyPageTransform(copied, page);
        fitPageToA4(copied);
        merged.addPage(copied);
      } else {
        await appendImage(merged, source, page, compressImage);
      }
    } catch (err) {
      console.error('Skipping page during merge:', source.name, page.sourceIndex, err);
      failedFiles.set(page.fileId, SKIP_UNREADABLE);
      skipped.push({ name: source.name, reason: SKIP_UNREADABLE });
      continue;
    }

    if (source.fileId !== lastBookmarkedFile) {
      bookmarks.push({ title: source.name, pageIndex: merged.getPageCount() - 1 });
      lastBookmarkedFile = source.fileId;
    }

    // Yield between pages so the progress overlay repaints and a cancel click is seen. The
    // merge runs on the main thread; without this the tab simply freezes until it finishes.
    if (i % 5 === 4) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (merged.getPageCount() === 0) {
    throw new Error(
      skipped.length
        ? 'None of the files could be merged (all were corrupt, encrypted, or unreadable).'
        : 'No pages to merge.',
    );
  }

  addOutline(merged, bookmarks);

  merged.setProducer('Merge Files Locally');
  merged.setCreator('Merge Files Locally');
  if (title) merged.setTitle(title);

  onProgress?.('Compressing PDF...');
  const bytes = await merged.save({ useObjectStreams: true, addDefaultPage: false });

  return { bytes, skipped };
}

// "report.pdf (password-protected), scan.png (unreadable)"
export function describeSkipped(skipped) {
  return skipped.map((s) => `${s.name} (${s.reason})`).join(', ');
}
