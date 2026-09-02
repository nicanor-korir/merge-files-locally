import { isCropMeaningful, normalizeRotation } from './pdf-geometry.js';

const PASSTHROUGH_TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/**
 * Pick the output encoding.
 *
 * PNG only pays for itself on the sources it was designed for — screenshots, line art, text —
 * where JPEG leaves visible ringing. Re-encoding a photograph as PNG at "Original" would
 * produce an enormous file for no visible gain, so photographic sources stay JPEG at a
 * near-lossless quality instead.
 */
export function chooseFormat(preset, sourceType) {
  if (!preset.lossless) return 'jpeg';
  return sourceType === 'image/png' ? 'png' : 'jpeg';
}

// An untouched image at a lossless preset has nothing to gain from a canvas round-trip, so it
// goes to the output byte-for-byte rather than becoming a second generation of itself.
export function passthroughFormat(file, { preset, rotation, crop, forceCanvas }) {
  if (forceCanvas || !preset.lossless) return null;
  if (normalizeRotation(rotation) !== 0 || isCropMeaningful(crop)) return null;
  return PASSTHROUGH_TYPES[file.type] ?? null;
}

/**
 * Work out the geometry for an image transform: the rotated bounds, the source rectangle the
 * crop selects from them, and the final output size after the preset's dimension cap.
 *
 * Pure, and shared by both encoders — the DOM one and the OffscreenCanvas one in the worker —
 * so the two can never disagree about what a given rotation and crop mean.
 */
export function computeImageDraw(width, height, { rotation = 0, crop = null, preset }) {
  const angle = normalizeRotation(rotation);
  const quarter = angle === 90 || angle === 270;
  const rotW = quarter ? height : width;
  const rotH = quarter ? width : height;

  // The crop rect is a 0..1 fraction of the rotated image, y-down — the same convention canvas
  // uses, so it indexes directly.
  const box = isCropMeaningful(crop)
    ? {
        x: Math.round(crop.x * rotW),
        y: Math.round(crop.y * rotH),
        width: Math.max(1, Math.round(crop.width * rotW)),
        height: Math.max(1, Math.round(crop.height * rotH)),
      }
    : { x: 0, y: 0, width: rotW, height: rotH };

  let outW = box.width;
  let outH = box.height;
  const cap = preset.maxDimension;
  if (Number.isFinite(cap) && (outW > cap || outH > cap)) {
    const ratio = Math.min(cap / outW, cap / outH);
    outW = Math.max(1, Math.round(outW * ratio));
    outH = Math.max(1, Math.round(outH * ratio));
  }

  return { angle, srcW: width, srcH: height, rotW, rotH, box, outW, outH };
}

/**
 * Paint the rotated, cropped image into `target`, given 2D contexts for an intermediate
 * rotation buffer and the target itself.
 *
 * Rotation is applied before cropping, in that order, because the user cropped what they saw
 * — and what they saw was already rotated. Two passes keep that honest: the crop rect indexes
 * straight into the rotated bitmap, in the same orientation the user drew it.
 */
export function paintTransformed(source, rotCtx, targetCtx, plan, format) {
  const { angle, srcW, srcH, rotW, rotH, box, outW, outH } = plan;

  // JPEG has no alpha; flatten transparency onto white so transparent regions render as white
  // rather than black. PNG keeps its alpha, so only flatten when heading to JPEG.
  if (format === 'jpeg') {
    rotCtx.fillStyle = '#ffffff';
    rotCtx.fillRect(0, 0, rotW, rotH);
  }
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate((angle * Math.PI) / 180);
  rotCtx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);

  if (format === 'jpeg') {
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, outW, outH);
  }
  targetCtx.drawImage(rotCtx.canvas, box.x, box.y, box.width, box.height, 0, 0, outW, outH);
}
