import { isCropMeaningful, normalizeRotation } from './pdf-geometry.js';

/**
 * Browser-only: convert an image to a compressed baseline JPEG, applying the page's rotation
 * and crop on the way. Baseline JPEG is the only image format pdf-lib's embedJpg() accepts.
 *
 * Rotation is applied before cropping, in that order, because the user cropped what they saw
 * — and what they saw was already rotated. Doing it in two canvas passes keeps that honest:
 * the crop rect indexes straight into the rotated bitmap, in the same orientation and the same
 * y-down direction the user drew it.
 *
 * Kept out of merge.js so the merge logic stays DOM-free and testable in Node.
 */
export function compressImage(file, { rotation = 0, crop = null, maxDimension = 1600, quality = 0.75 } = {}) {
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

      const angle = normalizeRotation(rotation);
      const quarter = angle === 90 || angle === 270;
      const rotW = quarter ? h : w;
      const rotH = quarter ? w : h;

      const rotated = document.createElement('canvas');
      rotated.width = rotW;
      rotated.height = rotH;
      const rctx = rotated.getContext('2d');
      // JPEG has no alpha; flatten transparency onto white so transparent PNG/WebP regions
      // render as white rather than black.
      rctx.fillStyle = '#ffffff';
      rctx.fillRect(0, 0, rotW, rotH);
      rctx.translate(rotW / 2, rotH / 2);
      rctx.rotate((angle * Math.PI) / 180);
      rctx.drawImage(img, -w / 2, -h / 2, w, h);

      // The crop rect is a 0..1 fraction of the rotated image, y-down — the same convention
      // canvas uses, so it indexes directly.
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
      if (outW > maxDimension || outH > maxDimension) {
        const ratio = Math.min(maxDimension / outW, maxDimension / outH);
        outW = Math.max(1, Math.round(outW * ratio));
        outH = Math.max(1, Math.round(outH * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(rotated, box.x, box.y, box.width, box.height, 0, 0, outW, outH);

      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) return reject(new Error('Canvas conversion failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}
