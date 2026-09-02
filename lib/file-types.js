export const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';
export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const ACCEPTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];

// Soft thresholds for warning about large in-memory merges (no hard limit).
export const LARGE_FILE_COUNT = 50;
export const LARGE_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB

export function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

// Tolerates an empty/missing MIME type by falling back to the extension. Browsers
// (especially on Linux, or for dragged files) sometimes report file.type === '', which would
// otherwise silently reject a perfectly valid PDF or image.
export function isAcceptedFile(file) {
  if (file.type && ACCEPTED_TYPES.includes(file.type)) return true;
  if (!file.type && ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))) return true;
  return false;
}

// Normalize a file to a canonical MIME type so downstream code always sees a real one.
export function resolveType(file) {
  if (file.type) return file.type;
  const ext = fileExtension(file.name);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return '';
}

// Name the download after the first merged file: "report.pdf" -> "report-merged.pdf".
export function buildDownloadName(firstName) {
  const base = (firstName || 'merged').replace(/\.[^.]+$/, '').trim();
  return `${base || 'merged'}-merged.pdf`;
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// crypto.randomUUID() only exists in secure contexts (HTTPS / localhost). This app is
// designed to run offline from any static server or file://, where it may be undefined —
// fall back to getRandomValues so adding files never throws.
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80; // variant
    const hex = [...buf].map((b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // Last-resort fallback (non-cryptographic, only for ancient/locked-down environments).
  return `id-${performance.now().toString(36).replace('.', '')}-${((performance.now() * 1000) % 1e9 | 0).toString(36)}`;
}
