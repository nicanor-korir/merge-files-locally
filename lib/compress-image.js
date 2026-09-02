// Browser-only: converts any supported image to a compressed baseline JPEG, which is the
// only image format pdf-lib's embedJpg() accepts. Kept out of merge.js so the merge logic
// stays DOM-free and testable in Node.
export function compressImage(file, maxDimension = 1600, quality = 0.75) {
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
      let { naturalWidth: w, naturalHeight: h } = img;

      // Guard against images with no intrinsic dimensions (e.g. some SVGs) which would
      // otherwise produce a zero-size canvas and a blank or broken page.
      if (!w || !h) {
        cleanup();
        reject(new Error('Image has no intrinsic dimensions'));
        return;
      }

      if (w > maxDimension || h > maxDimension) {
        const ratio = Math.min(maxDimension / w, maxDimension / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // JPEG has no alpha; flatten transparency onto white so transparent PNG/WebP regions
      // render as white rather than black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
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
