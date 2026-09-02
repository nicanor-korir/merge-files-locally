// Programmatic PDF fixtures. Built rather than committed as binaries so each one states
// exactly which property it exists to exercise.
import { PDFDocument, PDFName } from 'pdf-lib';

export const LINK_RECT = [50, 50, 200, 80];

async function withLinkAnnotation(doc, page, rect) {
  const ctx = doc.context;
  const link = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: ctx.obj({ Type: 'Action', S: 'URI', URI: 'https://example.com' }),
  });
  page.node.set(PDFName.of('Annots'), ctx.obj([link]));
}

/** A page of the given size, optionally rotated, optionally carrying a link annotation. */
export async function makePdf({ width = 300, height = 400, rotate = 0, link = false, pages = 1 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([width, height]);
    page.drawText(`page ${i + 1}`, { x: 20, y: height - 40, size: 12 });
    if (rotate) page.setRotation({ type: 'degrees', angle: rotate });
    if (link && i === 0) await withLinkAnnotation(doc, page, LINK_RECT);
  }
  return doc.save();
}

/** A document with one filled, interactive text field. */
export async function makeFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const field = doc.getForm().createTextField('applicant.name');
  field.setText('Ada Lovelace');
  field.addToPage(page, { x: 20, y: 300, width: 200, height: 24 });
  return doc.save();
}

/**
 * A document carrying an /Encrypt entry in its trailer. pdf-lib cannot write real
 * encryption, but the trailer entry is exactly what `isEncrypted` reads, which is the
 * branch we need to cover.
 */
export async function makeEncryptedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]).drawText('secret');
  const ctx = doc.context;
  ctx.trailerInfo.Encrypt = ctx.register(
    ctx.obj({ Filter: 'Standard', V: 1, R: 2, O: '', U: '', P: -1 }),
  );
  return doc.save({ useObjectStreams: false });
}

/** A structurally valid PDF with no pages at all. */
export async function makeEmptyPdf() {
  return (await PDFDocument.create()).save({ addDefaultPage: false });
}

export function makeCorruptPdf() {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xde, 0xad, 0xbe, 0xef]);
}

/** A source document, the shape mergeDocuments() resolves page references against. */
export function asSource(bytes, name, type = 'application/pdf') {
  return { fileId: name, name, type, size: bytes.length, file: new File([bytes], name, { type }) };
}

/** Page entries covering every page of a source, in order. */
export function pagesOf(source, count = 1, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${source.fileId}#${i}`,
    fileId: source.fileId,
    sourceIndex: i,
    rotation: 0,
    crop: null,
    ...overrides,
  }));
}
