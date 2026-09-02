import { PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib';

// A4 page dimensions in points.
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

// Annotation entries that hold absolute page coordinates as alternating x/y numbers. This
// mirrors pdf-lib's own scaleAnnot() key list with one deliberate omission: /RD holds
// *relative* inset distances, so it scales with the page but must never be shifted.
const TRANSLATABLE_KEYS = ['CL', 'Vertices', 'QuadPoints', 'L', 'Rect'];

function translateNumberArray(array, dx, dy) {
  for (let idx = 0, len = array.size(); idx < len; idx++) {
    const el = array.lookup(idx);
    if (el instanceof PDFNumber) {
      array.set(idx, PDFNumber.of(el.asNumber() + (idx % 2 === 0 ? dx : dy)));
    }
  }
}

function translateAnnot(annot, dx, dy) {
  for (const key of TRANSLATABLE_KEYS) {
    const list = annot.lookup(PDFName.of(key));
    if (list instanceof PDFArray) translateNumberArray(list, dx, dy);
  }
  const inkLists = annot.lookup(PDFName.of('InkList'));
  if (inkLists instanceof PDFArray) {
    for (let idx = 0, len = inkLists.size(); idx < len; idx++) {
      const stroke = inkLists.lookup(idx);
      if (stroke instanceof PDFArray) translateNumberArray(stroke, dx, dy);
    }
  }
}

// pdf-lib ships scaleAnnotations() but no translate counterpart, so page.translateContent()
// on its own leaves links and widgets behind at their original coordinates — the visible
// text moves and the clickable box does not.
export function translateAnnotations(page, dx, dy) {
  if (!dx && !dy) return;
  const annots = page.node.Annots();
  if (!annots) return;
  for (let idx = 0, len = annots.size(); idx < len; idx++) {
    const annot = annots.lookup(idx);
    if (annot instanceof PDFDict) translateAnnot(annot, dx, dy);
  }
}

// Scale factor that fits a visual box inside A4. Capped at 1: a PDF page carries a real
// physical size, so enlarging a small one (a receipt, a half-letter slip) only produces a
// soft, blown-up scan.
export function fitScale(visW, visH) {
  return Math.min(A4_WIDTH / visW, A4_HEIGHT / visH, 1);
}

// Where the *visual* top edge sits in content space, per /Rotate value. The display rotation
// is applied after the content is drawn, so 90 (clockwise) puts the content's left edge on
// top, 270 puts its right edge on top, and 180 puts its bottom edge on top. Horizontal
// centring always happens on the other axis.
function contentOffset(rotation, padX, padY) {
  if (rotation === 90) return { dx: 0, dy: padY / 2 };
  if (rotation === 270) return { dx: padX, dy: padY / 2 };
  if (rotation === 180) return { dx: padX / 2, dy: 0 };
  return { dx: padX / 2, dy: padY };
}

// Fit a copied page onto an A4 sheet: scale down to fit, centre horizontally, pin to the top,
// and carry the page's annotations through both transforms.
export function fitPageToA4(page) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const rotated = rotation === 90 || rotation === 270;
  const { width: mw, height: mh } = page.getSize();
  if (!mw || !mh) return; // degenerate media box — leave it alone rather than divide by zero

  const scale = fitScale(rotated ? mh : mw, rotated ? mw : mh);
  if (scale !== 1) {
    page.scaleContent(scale, scale);
    page.scaleAnnotations(scale, scale);
  }

  const scaledW = mw * scale;
  const scaledH = mh * scale;

  // The media box lives in content space. A 90/270 page swaps axes on display, so an A4
  // *display* box needs a content box of A4 height by A4 width.
  const boxW = Math.max(scaledW, rotated ? A4_HEIGHT : A4_WIDTH);
  const boxH = Math.max(scaledH, rotated ? A4_WIDTH : A4_HEIGHT);
  page.setSize(boxW, boxH);

  const { dx, dy } = contentOffset(rotation, boxW - scaledW, boxH - scaledH);
  if (dx || dy) {
    page.translateContent(dx, dy);
    translateAnnotations(page, dx, dy);
  }
}

// Place an image within the A4 box. Unlike a PDF page, an image has no intrinsic physical
// size — its pixels are not points — so there is nothing to preserve and scaling up to fill
// the sheet is the expected result.
export function fitToA4Box(imgW, imgH) {
  const scale = Math.min(A4_WIDTH / imgW, A4_HEIGHT / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  return {
    scale,
    drawW,
    drawH,
    pageW: Math.max(drawW, A4_WIDTH),
    pageH: Math.max(drawH, A4_HEIGHT),
  };
}
