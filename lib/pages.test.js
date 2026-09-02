import { describe, expect, it } from 'vitest';
import {
  arePagesGroupedByFile,
  cropPage,
  isPristine,
  makePage,
  moveFileBlock,
  movePage,
  reconcilePages,
  removePage,
  renderKey,
  rotatePage,
} from './pages.js';

const source = (fileId, pageCount) => ({ fileId, pageCount });
const ids = (pages) => pages.map((p) => `${p.fileId}:${p.sourceIndex}`);

describe('reconcilePages', () => {
  it('appends every page of a newly added file', () => {
    const pages = reconcilePages([], [source('a', 3)], new Set());
    expect(ids(pages)).toEqual(['a:0', 'a:1', 'a:2']);
  });

  it('appends a new file after the pages already arranged', () => {
    const first = reconcilePages([], [source('a', 2)], new Set());
    const second = reconcilePages(first, [source('a', 2), source('b', 1)], new Set(['a']));
    expect(ids(second)).toEqual(['a:0', 'a:1', 'b:0']);
  });

  it('keeps positions and transforms when an unrelated file is added', () => {
    const start = [
      { ...makePage('a', 1), rotation: 90 },
      makePage('a', 0),
    ];
    const next = reconcilePages(start, [source('a', 2), source('b', 1)], new Set(['a']));
    expect(ids(next)).toEqual(['a:1', 'a:0', 'b:0']);
    expect(next[0].rotation).toBe(90);
    expect(next[0].id).toBe(start[0].id); // same entry, not a rebuild
  });

  it('drops the pages of a removed file', () => {
    const start = [makePage('a', 0), makePage('b', 0), makePage('a', 1)];
    const next = reconcilePages(start, [source('a', 2)], new Set(['a', 'b']));
    expect(ids(next)).toEqual(['a:0', 'a:1']);
  });

  it('does not resurrect pages the user deleted', () => {
    // The file is still in the list, but its pages have already been generated once. A
    // reconcile pass must not add them back just because they are missing.
    const next = reconcilePages([], [source('a', 3)], new Set(['a']));
    expect(next).toEqual([]);
  });

  it('returns the same array when nothing changed, so React can skip the re-render', () => {
    const start = [makePage('a', 0)];
    expect(reconcilePages(start, [source('a', 1)], new Set(['a']))).toBe(start);
  });

  it('drops pages whose index no longer exists in a shrunken source', () => {
    const start = [makePage('a', 0), makePage('a', 5)];
    expect(ids(reconcilePages(start, [source('a', 2)], new Set(['a'])))).toEqual(['a:0']);
  });
});

describe('renderKey', () => {
  it('ignores rotation and crop, which are applied over the rendered bitmap', () => {
    const base = makePage('a', 2);
    const turned = { ...base, rotation: 180, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } };
    expect(renderKey(turned)).toBe(renderKey(base));
  });

  it('distinguishes pages of the same file', () => {
    expect(renderKey(makePage('a', 0))).not.toBe(renderKey(makePage('a', 1)));
  });
});

describe('page operations', () => {
  it('accumulates rotation in quarter turns and wraps', () => {
    let pages = [makePage('a', 0)];
    const id = pages[0].id;
    pages = rotatePage(pages, id, 90);
    expect(pages[0].rotation).toBe(90);
    pages = rotatePage(pages, id, 270);
    expect(pages[0].rotation).toBe(0);
    pages = rotatePage(pages, id, -90);
    expect(pages[0].rotation).toBe(270);
  });

  it('stores a real crop and discards a full-page one', () => {
    let pages = [makePage('a', 0)];
    const id = pages[0].id;
    pages = cropPage(pages, id, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(pages[0].crop).not.toBeNull();
    pages = cropPage(pages, id, { x: 0, y: 0, width: 1, height: 1 });
    expect(pages[0].crop).toBeNull();
  });

  it('moves a page to an absolute position', () => {
    const pages = [makePage('a', 0), makePage('a', 1), makePage('a', 2)];
    expect(ids(movePage(pages, pages[2].id, 0))).toEqual(['a:2', 'a:0', 'a:1']);
    expect(ids(movePage(pages, pages[0].id, 2))).toEqual(['a:1', 'a:2', 'a:0']);
  });

  it('clamps a move past either end instead of losing the page', () => {
    const pages = [makePage('a', 0), makePage('a', 1)];
    expect(ids(movePage(pages, pages[0].id, -5))).toEqual(['a:0', 'a:1']);
    expect(ids(movePage(pages, pages[0].id, 99))).toEqual(['a:1', 'a:0']);
  });

  it('leaves the list untouched for an unknown id', () => {
    const pages = [makePage('a', 0)];
    expect(movePage(pages, 'nope', 0)).toBe(pages);
    expect(rotatePage(pages, 'nope', 90)[0].rotation).toBe(0);
  });

  it('removes one page by id', () => {
    const pages = [makePage('a', 0), makePage('a', 1)];
    expect(ids(removePage(pages, pages[0].id))).toEqual(['a:1']);
  });
});

describe('isPristine', () => {
  it('is true only for an untransformed page', () => {
    expect(isPristine(makePage('a', 0))).toBe(true);
    expect(isPristine({ ...makePage('a', 0), rotation: 90 })).toBe(false);
    expect(isPristine({ ...makePage('a', 0), crop: { x: 0, y: 0, width: 0.5, height: 1 } })).toBe(false);
    // A full-page crop is not a transform.
    expect(isPristine({ ...makePage('a', 0), crop: { x: 0, y: 0, width: 1, height: 1 } })).toBe(true);
  });
});

describe('document-level moves', () => {
  const grouped = () => [makePage('a', 0), makePage('a', 1), makePage('b', 0), makePage('c', 0)];

  it('recognises pages still grouped by file', () => {
    expect(arePagesGroupedByFile(grouped())).toBe(true);
    expect(arePagesGroupedByFile([])).toBe(true);
  });

  it('recognises pages the user has interleaved', () => {
    const mixed = [makePage('a', 0), makePage('b', 0), makePage('a', 1)];
    expect(arePagesGroupedByFile(mixed)).toBe(false);
  });

  it('moves a document past its neighbour, keeping internal order', () => {
    expect(ids(moveFileBlock(grouped(), 'b', -1))).toEqual(['b:0', 'a:0', 'a:1', 'c:0']);
    expect(ids(moveFileBlock(grouped(), 'a', 1))).toEqual(['b:0', 'a:0', 'a:1', 'c:0']);
  });

  it('refuses to move at the ends', () => {
    const pages = grouped();
    expect(moveFileBlock(pages, 'a', -1)).toBe(pages);
    expect(moveFileBlock(pages, 'c', 1)).toBe(pages);
  });

  it('refuses to move once pages are interleaved, rather than silently regrouping them', () => {
    const mixed = [makePage('a', 0), makePage('b', 0), makePage('a', 1)];
    expect(moveFileBlock(mixed, 'a', 1)).toBe(mixed);
  });
});
