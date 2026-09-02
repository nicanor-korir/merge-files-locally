import { isCropMeaningful, normalizeRotation } from './pdf-geometry.js';
import { qualityOf } from './output-settings.js';

const PASSTHROUGH_TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png' };

/**
 * Pick the output encoding.
 *
 * PNG only pays for itself on the sources it was designed for — screenshots, line art, text —
 * where JPEG leaves visible ringing. Re-encoding a photograph as PNG at "Original" would
 * produce an enormous file for no visible gain, so photographic sources stay JPEG at a
 * near-lossless quality instead.
 */
function chooseFormat(preset, sourceType) {
  if (!preset.lossless) return 'jpeg';
  return sourceType === 'image/png' ? 'png' : 'jpeg';
}

/**
 * Browser-only: convert an image for embedding, applying the page's rotation and crop.
 *
 * Rotation is applied before cropping, in that order, because the user cropped what they saw
 * — and what they saw was already rotated. Two canvas passes keep that honest: the crop rect
 * indexes straight into the rotated bitmap, in the same orientation and the same y-down
 * direction the user drew it.
 *
 * Kept out of merge.js so the merge logic stays DOM-free and testable in Node.
 *
 * @returns {Promise<{bytes: ArrayBuffer, format: 'jpeg'|'png', passthrough: boolean}>}
 */
export async function compressImage(file, options = {}) {
  const { rotation = 0, crop = null, forceCanvas = false } = options;
  const preset = options.preset ?? qualityOf();
  const angle = normalizeRotation(rotation);
  const cropped = isCropMeaningful(crop);

  // Nothing to change and nothing to gain by re-encoding: hand the original bytes straight
  // through, so "Original" really is the original and not a second generation of it.
  const passthroughFormat = PASSTHROUGH_TYPES[file.type];
  if (preset.lossless && !forceCanvas && !angle && !cropped && passthroughFormat) {
    return { bytes: await file.arrayBuffer(), format: passthroughFormat, passthrough: true };
  }

  const format = chooseFormat(preset, file.type);
  const bytes = await drawToBlob(file, { angle, crop: cropped ? crop : null, preset, format });
  return { bytes, format, passthrough: false };
}

function drawToBlob(file, { angle, crop, preset, format }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    // Revoke exactly once, on every exit path (success or failure), to avoid leaks.
    let revoked = false;
    const cleanup = () => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;

      // Guard against images with no intrinsic dimensions (e.g. some SVGs) which would
      // otherwise produce a zero-size canvas and a blank or broken page.
      if (!w || !h) {
        cleanup();
        reject(new Error('Image has no intrinsic dimensions'));
        return;
      }

      const quarter = angle === 90 || angle === 270;
      const rotW = quarter ? h : w;
      const rotH = quarter ? w : h;

      const rotated = document.createElement('canvas');
      rotated.width = rotW;
      rotated.height = rotH;
      const rctx = rotated.getContext('2d');
      // JPEG has no alpha; flatten transparency onto white so transparent regions render as
      // white rather than black. PNG keeps its alpha, so only flatten when heading to JPEG.
      if (format === 'jpeg') {
        rctx.fillStyle = '#ffffff';
        rctx.fillRect(0, 0, rotW, rotH);
      }
      rctx.translate(rotW / 2, rotH / 2);
      rctx.rotate((angle * Math.PI) / 180);
      rctx.drawImage(img, -w / 2, -h / 2, w, h);

      // The crop rect is a 0..1 fraction of the rotated image, y-down — the same convention
      // canvas uses, so it indexes directly.
      const box = crop
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

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
      }
      ctx.drawImage(rotated, box.x, box.y, box.width, box.height, 0, 0, outW, outH);

      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) return reject(new Error('Canvas conversion failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        },
        format === 'png' ? 'image/png' : 'image/jpeg',
        preset.jpegQuality,
      );
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}
