// Output options. Defaults are chosen so most people never open these: A4 because it is the
// most common page size worldwide, and "balanced" because an unconditional aggressive
// downsample is what used to ruin scans.

export const PAGE_SIZES = {
  a4: { id: 'a4', label: 'A4', width: 595.28, height: 841.89 },
  letter: { id: 'letter', label: 'US Letter', width: 612, height: 792 },
  // No target box: each page keeps whatever size it already had. Images still land on A4,
  // because an image has no intrinsic physical size to preserve.
  original: { id: 'original', label: 'Keep original', width: null, height: null },
};

export const DEFAULT_PAGE_SIZE = 'a4';

/**
 * Image quality presets.
 *
 * `lossless` does two things: it re-encodes to PNG rather than JPEG when a transform forces a
 * canvas round-trip, and it lets an untouched image pass through to the output byte-for-byte.
 * The old behaviour — 1600px and JPEG 0.75 for everything, always — quietly put scans below
 * what OCR needs and left visible artefacts on screenshots of text.
 */
export const QUALITY_PRESETS = {
  original: { id: 'original', label: 'Original', maxDimension: Infinity, jpegQuality: 0.95, lossless: true },
  balanced: { id: 'balanced', label: 'Balanced', maxDimension: 2000, jpegQuality: 0.82, lossless: false },
  small: { id: 'small', label: 'Smaller file', maxDimension: 1200, jpegQuality: 0.65, lossless: false },
};

export const DEFAULT_QUALITY = 'balanced';

export function pageSizeOf(id) {
  return PAGE_SIZES[id] ?? PAGE_SIZES[DEFAULT_PAGE_SIZE];
}

export function qualityOf(id) {
  return QUALITY_PRESETS[id] ?? QUALITY_PRESETS[DEFAULT_QUALITY];
}

// Keep a user-typed filename usable as one: no control characters, no path separators, none
// of the characters Windows rejects, and exactly one .pdf extension. Falls back rather than
// producing a file called ".pdf".
export function sanitizeDownloadName(input, fallback = 'merged.pdf') {
  const cleaned = (input ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .trim()
    .replace(/\.pdf$/i, '')
    .trim();
  return cleaned ? `${cleaned}.pdf` : fallback;
}
