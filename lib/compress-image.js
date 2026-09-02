import { qualityOf } from './output-settings.js';
import { chooseFormat, computeImageDraw, paintTransformed, passthroughFormat } from './image-transform.js';

/**
 * Main-thread image encoder, used when the merge cannot run in a worker.
 *
 * Kept out of merge.js so the merge logic stays DOM-free and testable in Node. The worker
 * equivalent lives in compress-image-worker.js; both share the geometry in image-transform.js
 * so they cannot disagree about what a rotation and crop mean.
 *
 * @returns {Promise<{bytes: ArrayBuffer, format: 'jpeg'|'png', passthrough: boolean}>}
 */
export async function compressImage(file, options = {}) {
  const { rotation = 0, crop = null, forceCanvas = false } = options;
  const preset = options.preset ?? qualityOf();

  const direct = passthroughFormat(file, { preset, rotation, crop, forceCanvas });
  if (direct) {
    return { bytes: await file.arrayBuffer(), format: direct, passthrough: true };
  }

  const format = chooseFormat(preset, file.type);
  const bytes = await drawToBlob(file, { rotation, crop, preset, format });
  return { bytes, format, passthrough: false };
}

function drawToBlob(file, { rotation, crop, preset, format }) {
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

      const plan = computeImageDraw(w, h, { rotation, crop, preset });

      const rotated = document.createElement('canvas');
      rotated.width = plan.rotW;
      rotated.height = plan.rotH;
      const canvas = document.createElement('canvas');
      canvas.width = plan.outW;
      canvas.height = plan.outH;

      paintTransformed(img, rotated.getContext('2d'), canvas.getContext('2d'), plan, format);

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
