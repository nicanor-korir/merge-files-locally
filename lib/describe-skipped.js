// Its own module so the page can format a skipped-files message without importing merge.js,
// and with it pdf-lib, into the main bundle.

// "report.pdf (password-protected), scan.png (unreadable)"
export function describeSkipped(skipped) {
  return skipped.map((s) => `${s.name} (${s.reason})`).join(', ');
}
