import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { fitPageToA4, fitToA4Box } from './pdf-geometry.js';

export const SKIP_ENCRYPTED = 'password-protected';
export const SKIP_EMPTY = 'no pages';
export const SKIP_UNREADABLE = 'unreadable';

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

async function appendPdf(merged, arrayBuffer) {
  // ignoreEncryption lets pdf-lib *open* an encrypted file without decrypting it. The page
  // content streams stay encrypted, so copying them yields unreadable pages instead of an
  // error — the file would sail past a try/catch and land silently corrupt in the output.
  // Load permissively so the flag is readable, then refuse explicitly.
  const source = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true, updateMetadata: false });
  if (source.isEncrypted) throw new SkipFile(SKIP_ENCRYPTED);

  const indices = source.getPageIndices();
  if (indices.length === 0) throw new SkipFile(SKIP_EMPTY);

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

  const pages = await merged.copyPages(source, indices);
  for (const page of pages) {
    fitPageToA4(page);
    merged.addPage(page);
  }
}

async function appendImage(merged, file, compressImage) {
  // embedJpg only accepts baseline JPEG; the caller's canvas round-trip guarantees that.
  const jpgBuf = await compressImage(file);
  const image = await merged.embedJpg(jpgBuf);
  const { width: imgW, height: imgH } = image.scale(1);
  const { drawW, drawH, pageW, pageH } = fitToA4Box(imgW, imgH);
  const page = merged.addPage([pageW, pageH]);
  // Centre horizontally; pin to the top of the page.
  page.drawImage(image, { x: (pageW - drawW) / 2, y: pageH - drawH, width: drawW, height: drawH });
}

/**
 * Merge PDFs and images into one A4-fitted PDF.
 *
 * Each file is isolated: a corrupt, encrypted or unreadable one is skipped with a reason
 * rather than discarding the batch. `compressImage` is injected so this module stays free of
 * DOM APIs and can be tested in Node.
 *
 * @returns {Promise<{ bytes: Uint8Array, skipped: Array<{name: string, reason: string}> }>}
 */
export async function mergeDocuments(entries, { compressImage, onProgress, title } = {}) {
  // updateMetadata: false stops pdf-lib stamping its own Producer/Creator and a wall-clock
  // timestamp into the info dict, so the values set below are the only ones the output carries.
  const merged = await PDFDocument.create({ updateMetadata: false });
  const skipped = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.(`Processing ${i + 1} of ${entries.length}: ${entry.name}`);

    try {
      const arrayBuffer = await entry.file.arrayBuffer();
      if (entry.type === 'application/pdf') {
        await appendPdf(merged, arrayBuffer);
      } else {
        await appendImage(merged, entry.file, compressImage);
      }
    } catch (err) {
      if (!(err instanceof SkipFile)) console.error('Skipping file during merge:', entry.name, err);
      skipped.push({ name: entry.name, reason: err instanceof SkipFile ? err.reason : SKIP_UNREADABLE });
    }
  }

  if (merged.getPageCount() === 0) {
    throw new Error(
      skipped.length
        ? 'None of the files could be merged (all were corrupt, encrypted, or unreadable).'
        : 'No pages to merge.',
    );
  }

  // Deliberate, minimal metadata: the output should not advertise the library that built it,
  // and should not inherit anything from the sources.
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
