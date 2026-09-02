import { generateId } from './file-types.js';
import { isCropMeaningful, normalizeRotation } from './pdf-geometry.js';

// A page entry is one page of the *output* document. It never holds pixels or bytes — only a
// pointer back to a source file plus the transforms the user applied. That is what makes
// reordering, rotating and cropping cheap: none of them invalidate a rendered preview.
export function makePage(fileId, sourceIndex) {
  return { id: generateId(), fileId, sourceIndex, rotation: 0, crop: null };
}

// The cache key for a rendered preview. Deliberately excludes rotation and crop: both are
// applied as CSS over the rendered bitmap, so neither needs a re-render.
export function renderKey(page) {
  return `${page.fileId}:${page.sourceIndex}`;
}

/**
 * Reconcile the page list against the current sources.
 *
 * Pages of a file that is still present keep their position and their transforms. Pages of a
 * removed file drop out. A file whose pages have never been generated appends all of them at
 * the end — `seenFileIds` is what stops a file the user has emptied page by page from
 * silently resurrecting itself.
 *
 * @param {Array} pages current page entries
 * @param {Array<{fileId: string, pageCount: number}>} sources
 * @param {Set<string>} seenFileIds files whose pages have already been added at least once
 */
export function reconcilePages(pages, sources, seenFileIds) {
  const counts = new Map(sources.map((s) => [s.fileId, s.pageCount]));

  const kept = pages.filter((page) => {
    const count = counts.get(page.fileId);
    return count !== undefined && page.sourceIndex < count;
  });

  const added = [];
  for (const source of sources) {
    if (seenFileIds.has(source.fileId)) continue;
    for (let i = 0; i < source.pageCount; i++) added.push(makePage(source.fileId, i));
  }

  return kept.length === pages.length && added.length === 0 ? pages : [...kept, ...added];
}

// Every operation below returns the *same array* when it would change nothing. The undo stack
// records whatever array an operation replaced, so an operation that quietly returned an
// equivalent-but-new array would push a history entry that undoes to an identical state — an
// Undo button that visibly does nothing.

export function rotatePage(pages, id, delta) {
  const turn = normalizeRotation(delta);
  if (turn === 0 || !pages.some((p) => p.id === id)) return pages;
  return pages.map((p) =>
    p.id === id ? { ...p, rotation: normalizeRotation(p.rotation + turn) } : p,
  );
}

function sameCrop(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function cropPage(pages, id, crop) {
  const next = isCropMeaningful(crop) ? crop : null;
  const target = pages.find((p) => p.id === id);
  if (!target || sameCrop(target.crop, next)) return pages;
  return pages.map((p) => (p.id === id ? { ...p, crop: next } : p));
}

export function removePage(pages, id) {
  if (!pages.some((p) => p.id === id)) return pages;
  return pages.filter((p) => p.id !== id);
}

// Move a page to a new absolute position, clamped. Used by both the arrow buttons and drop.
export function movePage(pages, id, toIndex) {
  const from = pages.findIndex((p) => p.id === id);
  if (from === -1) return pages;
  const to = Math.max(0, Math.min(pages.length - 1, toIndex));
  if (to === from) return pages;
  const copy = [...pages];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

// True when a page still shows its source unaltered — used to label the page in the UI.
export function isPristine(page) {
  return page.rotation === 0 && !isCropMeaningful(page.crop);
}

// True when every file's pages sit in one contiguous run. That is the normal state, and the
// only one in which "move this document" has an unambiguous meaning — once a user has
// interleaved pages by hand, there is no block left to move.
export function arePagesGroupedByFile(pages) {
  const seen = new Set();
  let current = null;
  for (const page of pages) {
    if (page.fileId === current) continue;
    if (seen.has(page.fileId)) return false;
    seen.add(page.fileId);
    current = page.fileId;
  }
  return true;
}

// Move a whole document's pages one slot earlier or later among the other documents, keeping
// each document's internal page order intact.
export function moveFileBlock(pages, fileId, direction) {
  if (!arePagesGroupedByFile(pages)) return pages;

  const order = [];
  for (const page of pages) if (!order.includes(page.fileId)) order.push(page.fileId);

  const from = order.indexOf(fileId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= order.length) return pages;
  [order[from], order[to]] = [order[to], order[from]];

  const byFile = new Map(order.map((id) => [id, []]));
  for (const page of pages) byFile.get(page.fileId).push(page);
  return order.flatMap((id) => byFile.get(id));
}
