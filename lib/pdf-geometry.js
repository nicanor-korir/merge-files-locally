import { degrees, PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib';

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

export function normalizeRotation(angle) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

// A crop only matters if it actually removes something; a full-page rect is a no-op and not
// worth rewriting the page boxes for.
export function isCropMeaningful(crop) {
  if (!crop) return false;
  return crop.x > 0.001 || crop.y > 0.001 || crop.width < 0.999 || crop.height < 0.999;
}

/**
 * Map a normalized crop rect into the page's unrotated content space.
 *
 * The rect arrives the way a user drew it: over the page *as displayed*, origin at the
 * top-left, y running down, each value a 0..1 fraction. Content space is the opposite on both
 * counts — origin bottom-left, y up — and the display rotation swaps the axes on top of that.
 *
 * The per-rotation mappings come from where each content corner lands once /Rotate is applied.
 * For 90 (clockwise) the content's bottom-left corner becomes the display's top-left, which
 * makes `dx = cy` and `dy = W - cx`; inverting that gives the branch below. 270 is the mirror,
 * and 180 simply reflects both axes.
 */
export function cropToContentRect(crop, mediaW, mediaH, rotation) {
  const rotated = rotation === 90 || rotation === 270;
  const visW = rotated ? mediaH : mediaW;
  const visH = rotated ? mediaW : mediaH;

  // Normalized, y-down -> visual PDF units, y-up.
  const vx = crop.x * visW;
  const vy = (1 - crop.y - crop.height) * visH;
  const vw = crop.width * visW;
  const vh = crop.height * visH;

  if (rotation === 90) return { x: mediaW - vy - vh, y: vx, width: vh, height: vw };
  if (rotation === 180) return { x: mediaW - vx - vw, y: mediaH - vy - vh, width: vw, height: vh };
  if (rotation === 270) return { x: vy, y: mediaH - vx - vw, width: vh, height: vw };
  return { x: vx, y: vy, width: vw, height: vh };
}

// Move the page's visible box to the origin. Content coordinates are absolute, so a page whose
// box starts anywhere else would be pinned against the wrong edge by every transform after
// this one. The crop box is the reference, not the media box: it is what a viewer displays and
// therefore what the user cropped against in the preview.
function normalizeToOrigin(page) {
  const box = page.getCropBox();
  if (box.x !== 0 || box.y !== 0) {
    page.translateContent(-box.x, -box.y);
    translateAnnotations(page, -box.x, -box.y);
  }
  page.setMediaBox(0, 0, box.width, box.height);
  page.setCropBox(0, 0, box.width, box.height);
  return box;
}

/**
 * Apply the user's per-page rotation and crop, leaving the page at the origin so
 * fitPageToA4() only ever has one coordinate system to reason about.
 *
 * Rotation is added to whatever /Rotate the source already carried, because the user rotated
 * what they saw in the preview — which pdf.js had already rendered rotated.
 */
export function applyPageTransform(page, { rotation = 0, crop = null } = {}) {
  const box = normalizeToOrigin(page);
  const total = normalizeRotation(page.getRotation().angle + rotation);

  if (isCropMeaningful(crop)) {
    const rect = cropToContentRect(crop, box.width, box.height, total);
    page.translateContent(-rect.x, -rect.y);
    translateAnnotations(page, -rect.x, -rect.y);
    page.setMediaBox(0, 0, rect.width, rect.height);
    page.setCropBox(0, 0, rect.width, rect.height);
  }

  page.setRotation(degrees(total));
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
