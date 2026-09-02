import { qualityOf } from './output-settings.js';
import { chooseFormat, computeImageDraw, paintTransformed, passthroughFormat } from './image-transform.js';

/**
 * Worker-side image encoder: same contract as compress-image.js, but built on createImageBitmap
 * and OffscreenCanvas, neither of which needs a DOM. The geometry is shared, so this and the
 * main-thread encoder cannot drift.
 *
 * @returns {Promise<{bytes: ArrayBuffer, format: 'jpeg'|'png', passthrough: boolean}>}
 */
export async function compressImageInWorker(file, options = {}) {
  const { rotation = 0, crop = null, forceCanvas = false } = options;
  const preset = options.preset ?? qualityOf();

  const direct = passthroughFormat(file, { preset, rotation, crop, forceCanvas });
  if (direct) {
    return { bytes: await file.arrayBuffer(), format: direct, passthrough: true };
  }

  const format = chooseFormat(preset, file.type);
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Image has no intrinsic dimensions');
    const plan = computeImageDraw(bitmap.width, bitmap.height, { rotation, crop, preset });

    const rotated = new OffscreenCanvas(plan.rotW, plan.rotH);
    const target = new OffscreenCanvas(plan.outW, plan.outH);
    paintTransformed(bitmap, rotated.getContext('2d'), target.getContext('2d'), plan, format);

    const blob = await target.convertToBlob({
      type: format === 'png' ? 'image/png' : 'image/jpeg',
      quality: preset.jpegQuality,
    });
    return { bytes: await blob.arrayBuffer(), format, passthrough: false };
  } finally {
    // Frees the decoded pixels immediately rather than waiting for GC — a 40-megapixel scan
    // is well over 100MB decoded, and a batch of them would otherwise pile up.
    bitmap.close();
  }
}
