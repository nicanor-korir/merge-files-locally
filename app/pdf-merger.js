'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compressImage } from '../lib/compress-image';
import {
  ACCEPTED,
  buildDownloadName,
  formatSize,
  generateId,
  isAcceptedFile,
  LARGE_FILE_COUNT,
  LARGE_TOTAL_BYTES,
  resolveType,
} from '../lib/file-types';
import { describeSkipped, MergeCancelled, mergeDocuments } from '../lib/merge';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_QUALITY,
  PAGE_SIZES,
  QUALITY_PRESETS,
  sanitizeDownloadName,
} from '../lib/output-settings';
import {
  arePagesGroupedByFile,
  cropPage,
  isPristine,
  moveFileBlock,
  movePage,
  reconcilePages,
  removePage,
  renderKey,
  rotatePage,
} from '../lib/pages';

const PREVIEW_SCALE = 1.4;
// Backing width for the display canvas, independent of the layout width so a wider column or
// a zoomed page stays sharp without re-rendering the PDF.
const CANVAS_WIDTH = 760;
// Rendered pages are held as ImageBitmaps — decoded pixels — so cap how many we keep. Evicted
// entries are dropped rather than close()d: a component may still hold one, and drawing a
// closed bitmap throws.
const MAX_CACHED_RASTERS = 60;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const lib = pdfjs.default || pdfjs;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  }
  return lib;
}

/**
 * Draw a page's cached raster with its rotation and crop applied.
 *
 * Deliberately the same order as compressImage(): rotate, then crop the rotated result. The
 * preview is what the user cropped against, so any divergence here would surface as an output
 * that does not match what they saw.
 */
function drawPage(canvas, bitmap, rotation, crop) {
  const quarter = rotation === 90 || rotation === 270;
  const rotW = quarter ? bitmap.height : bitmap.width;
  const rotH = quarter ? bitmap.width : bitmap.height;

  const cx = crop ? crop.x * rotW : 0;
  const cy = crop ? crop.y * rotH : 0;
  const cw = crop ? crop.width * rotW : rotW;
  const ch = crop ? crop.height * rotH : rotH;
  if (cw <= 0 || ch <= 0) return;

  const scale = CANVAS_WIDTH / cw;
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.translate(rotW / 2, rotH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();
}

export default function PdfMerger() {
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState([]);
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState('');
  const [toast, setToast] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [dragOverZone, setDragOverZone] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);
  const [croppingId, setCroppingId] = useState(null);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Empty means "use the derived name", which the placeholder shows.
  const [fileName, setFileName] = useState('');
  // Bumped when a source's page count becomes known, to trigger reconciliation.
  const [countsVersion, setCountsVersion] = useState(0);

  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const abortRef = useRef(null);
  // Mirrors, so effects and callbacks can read current values without re-subscribing.
  const filesRef = useRef(files);
  filesRef.current = files;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // fileId -> { pdf, task, pageCount, failed }. Each source is parsed once and kept open while
  // it is in the list, so rendering page 40 does not re-read the file.
  const docsRef = useRef(new Map());
  // renderKey -> ImageBitmap. Survives reorder, rotation, crop, and deletion of other pages.
  const rasterRef = useRef(new Map());
  // Sources whose pages have been generated once, so a document the user has emptied page by
  // page does not silently refill itself.
  const seenRef = useRef(new Set());

  useEffect(() => {
    const docs = docsRef.current;
    const rasters = rasterRef.current;
    return () => {
      filesRef.current.forEach((f) => {
        if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      });
      docs.forEach((entry) => entry.task?.destroy?.());
      docs.clear();
      rasters.clear();
    };
  }, []);

  // Arranging fifty pages and then closing the tab loses all of it — there is no server-side
  // copy to come back to, by design.
  useEffect(() => {
    if (pages.length === 0) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pages.length]);

  // -- Toast / announcements --

  const showToast = useCallback((msg, isError = false) => {
    setToast({ message: msg, isError });
    clearTimeout(toastTimer.current);
    // Errors linger a little longer so they can be read.
    toastTimer.current = setTimeout(() => setToast(null), isError ? 6000 : 2500);
  }, []);

  // A leading zero-width space forces the live region to change even when the same message
  // repeats (e.g. rotating twice), so it is re-announced.
  const announce = useCallback((msg) => {
    setLiveMessage((prev) => (prev === msg ? `​${msg}` : msg));
  }, []);

  // -- Open each source once, and learn how many pages it has --

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const docs = docsRef.current;
      let changed = false;

      for (const entry of files) {
        if (docs.has(entry.id)) continue;
        try {
          if (entry.type === 'application/pdf') {
            const lib = await loadPdfjs();
            const buffer = await entry.file.arrayBuffer();
            // isEvalSupported: false mitigates CVE-2024-4367 (arbitrary JS execution from a
            // crafted PDF via font handling) when rendering untrusted, user-supplied PDFs.
            const task = lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false });
            const pdf = await task.promise;
            if (cancelled) {
              task.destroy();
              return;
            }
            docs.set(entry.id, { pdf, task, pageCount: pdf.numPages });
          } else {
            docs.set(entry.id, { pdf: null, task: null, pageCount: 1 });
          }
        } catch (err) {
          console.error('Could not read file:', entry.name, err);
          docs.set(entry.id, { pdf: null, task: null, pageCount: 0, failed: true });
        }
        changed = true;
      }

      if (!cancelled && changed) setCountsVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  // -- Keep the page list in step with the sources --

  useEffect(() => {
    const docs = docsRef.current;
    const known = files
      .filter((f) => docs.has(f.id))
      .map((f) => ({ fileId: f.id, pageCount: docs.get(f.id).pageCount }));

    const next = reconcilePages(pagesRef.current, known, seenRef.current);
    for (const source of known) {
      if (source.pageCount > 0) seenRef.current.add(source.fileId);
    }
    if (next !== pagesRef.current) setPages(next);
  }, [files, countsVersion]);

  // -- Rendering --

  const getBitmap = useCallback(async (page) => {
    const key = renderKey(page);
    const cache = rasterRef.current;
    if (cache.has(key)) return cache.get(key);

    const source = filesRef.current.find((f) => f.id === page.fileId);
    if (!source) throw new Error('Source file is no longer available');

    let bitmap;
    if (source.type === 'application/pdf') {
      const pdf = docsRef.current.get(page.fileId)?.pdf;
      if (!pdf) throw new Error('Document is not open');
      const pdfPage = await pdf.getPage(page.sourceIndex + 1);
      const viewport = pdfPage.getViewport({ scale: PREVIEW_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      bitmap = await createImageBitmap(canvas);
      pdfPage.cleanup();
    } else {
      bitmap = await createImageBitmap(source.file);
    }

    cache.set(key, bitmap);
    while (cache.size > MAX_CACHED_RASTERS) {
      cache.delete(cache.keys().next().value);
    }
    return bitmap;
  }, []);

  // -- Add / remove sources --

  const addFiles = useCallback(
    (fileList) => {
      const newEntries = [];
      let skippedUnsupported = 0;
      let skippedEmpty = 0;
      let duplicates = 0;

      for (const file of fileList) {
        if (!isAcceptedFile(file)) {
          skippedUnsupported++;
          continue;
        }
        if (file.size === 0) {
          skippedEmpty++;
          continue;
        }
        // Added anyway — someone may genuinely want the same document twice — but say so,
        // because dropping a folder twice is the more common reason to see this.
        if (filesRef.current.some((f) => f.name === file.name && f.size === file.size)) {
          duplicates++;
        }
        const type = resolveType(file);
        newEntries.push({
          id: generateId(),
          file,
          name: file.name,
          size: file.size,
          type,
          thumbUrl: type.startsWith('image/') ? URL.createObjectURL(file) : null,
        });
      }

      if (skippedUnsupported > 0) {
        showToast(
          `${skippedUnsupported} file${skippedUnsupported > 1 ? 's' : ''} skipped (unsupported format)`,
        );
      } else if (skippedEmpty > 0) {
        showToast(`${skippedEmpty} empty file${skippedEmpty > 1 ? 's' : ''} skipped`);
      } else if (duplicates > 0) {
        showToast(`Added ${duplicates} file${duplicates > 1 ? 's' : ''} you already had`);
      }

      if (newEntries.length > 0) {
        const next = [...filesRef.current, ...newEntries];
        setFiles(next);
        const totalBytes = next.reduce((sum, f) => sum + f.size, 0);
        if (next.length > LARGE_FILE_COUNT || totalBytes > LARGE_TOTAL_BYTES) {
          showToast('Large selection - merging may take a while or use a lot of memory.', true);
        }
      }
    },
    [showToast],
  );

  const forgetFile = useCallback((entry) => {
    if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
    docsRef.current.get(entry.id)?.task?.destroy?.();
    docsRef.current.delete(entry.id);
    seenRef.current.delete(entry.id);
    for (const key of [...rasterRef.current.keys()]) {
      if (key.startsWith(`${entry.id}:`)) rasterRef.current.delete(key);
    }
  }, []);

  const removeFile = useCallback(
    (id) => {
      const entry = filesRef.current.find((f) => f.id === id);
      if (!entry) return;
      forgetFile(entry);
      announce(`Removed ${entry.name}`);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [announce, forgetFile],
  );

  const clearAll = useCallback(() => {
    const current = filesRef.current;
    if (current.length === 0) return;
    // Guard against accidental loss of the whole queue.
    if (typeof window !== 'undefined' && !window.confirm(`Remove all ${current.length} files?`)) {
      return;
    }
    current.forEach(forgetFile);
    announce('Cleared all files');
    setCroppingId(null);
    setPages([]);
    setFiles([]);
  }, [announce, forgetFile]);

  // -- Page operations --

  const grouped = useMemo(() => arePagesGroupedByFile(pages), [pages]);

  const moveDocument = useCallback(
    (fileId, direction) => {
      const entry = filesRef.current.find((f) => f.id === fileId);
      setPages((prev) => moveFileBlock(prev, fileId, direction));
      announce(`Moved ${entry?.name ?? 'document'} ${direction < 0 ? 'earlier' : 'later'}`);
    },
    [announce],
  );

  const onRotate = useCallback(
    (id, delta) => {
      setPages((prev) => rotatePage(prev, id, delta));
      announce(delta < 0 ? 'Rotated page left' : 'Rotated page right');
    },
    [announce],
  );

  const onDeletePage = useCallback(
    (id) => {
      const index = pagesRef.current.findIndex((p) => p.id === id);
      setPages((prev) => removePage(prev, id));
      setCroppingId((current) => (current === id ? null : current));
      announce(`Removed page ${index + 1}`);
    },
    [announce],
  );

  const onMovePage = useCallback(
    (id, direction) => {
      const from = pagesRef.current.findIndex((p) => p.id === id);
      const to = from + direction;
      if (to < 0 || to >= pagesRef.current.length) return;
      setPages((prev) => movePage(prev, id, to));
      announce(`Moved page to position ${to + 1} of ${pagesRef.current.length}`);
    },
    [announce],
  );

  const onApplyCrop = useCallback(
    (id, rect) => {
      setPages((prev) => cropPage(prev, id, rect));
      setCroppingId(null);
      announce(rect ? 'Crop applied' : 'Crop cleared');
    },
    [announce],
  );

  // -- Drag to reorder pages --

  const onDragStart = useCallback((id) => setDraggedId(id), []);
  const onDragOver = useCallback(
    (e, id) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (id !== draggedId) setDragTargetId(id);
    },
    [draggedId],
  );
  const onDragLeave = useCallback(() => setDragTargetId(null), []);
  const onDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragTargetId(null);
  }, []);

  const onItemDrop = useCallback(
    (targetId) => {
      setDragTargetId(null);
      if (!draggedId || targetId === draggedId) return;
      setPages((prev) => {
        const to = prev.findIndex((p) => p.id === targetId);
        return to === -1 ? prev : movePage(prev, draggedId, to);
      });
      setDraggedId(null);
    },
    [draggedId],
  );

  // -- Merge & download --

  const mergePdfs = useCallback(async () => {
    if (pages.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setMerging(true);
    setCroppingId(null);

    try {
      const derived = buildDownloadName(files[0]?.name);
      const downloadName = sanitizeDownloadName(fileName || derived, derived);
      const { bytes, skipped } = await mergeDocuments(pages, {
        sources: files.map((f) => ({ fileId: f.id, name: f.name, type: f.type, file: f.file })),
        compressImage,
        onProgress: setProgress,
        title: downloadName,
        signal: controller.signal,
        pageSize,
        quality,
      });

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.click();
      // Defer revoke: revoking immediately after click() can abort the download in some
      // browsers (older Firefox / certain download managers).
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      if (skipped.length) {
        // An error toast so it lingers and is announced assertively - a silently dropped file
        // is exactly what the user needs to hear about.
        showToast(
          `Merged. Skipped ${skipped.length} file${skipped.length > 1 ? 's' : ''}: ${describeSkipped(skipped)}`,
          true,
        );
      } else {
        showToast('PDF merged and downloaded!');
      }
    } catch (err) {
      if (err instanceof MergeCancelled) {
        showToast('Merge cancelled');
      } else {
        console.error('Merge failed:', err);
        showToast('Merge failed: ' + err.message, true);
      }
    } finally {
      setMerging(false);
      setProgress('');
      abortRef.current = null;
    }
  }, [pages, files, fileName, pageSize, quality, showToast]);

  const cancelMerge = useCallback(() => {
    abortRef.current?.abort();
    setProgress('Cancelling...');
  }, []);

  const pageCountsByFile = useMemo(() => {
    const counts = new Map();
    for (const page of pages) counts.set(page.fileId, (counts.get(page.fileId) ?? 0) + 1);
    return counts;
  }, [pages]);

  const totalPages = pages.length;

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="header-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 18v-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 15h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1>PDF Merger</h1>
            <p>Merge PDFs &amp; images locally - your files never leave your device.</p>
          </div>
          <div className="header-actions">
            {totalPages > 0 && (
              <button type="button" className="btn btn-primary btn-header-merge" onClick={mergePdfs} disabled={merging}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Merge &amp; Download
              </button>
            )}
            <div className="privacy-badge">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Private
            </div>
          </div>
        </div>
      </header>

      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          {/* Drag/drop is a mouse affordance; the "browse" button is the keyboard entry
              point, so this wrapper is not itself a button. */}
          <div
            className={`drop-zone${dragOverZone ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverZone(true);
            }}
            onDragLeave={() => setDragOverZone(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverZone(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <svg className="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M17 8l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="drop-zone-text">
              Drop files here or{' '}
              <button
                type="button"
                className="browse-link"
                aria-label="Browse for PDF or image files to merge"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                browse
              </button>
            </p>
            <p className="drop-zone-hint">PDF, PNG, JPG, JPEG, WebP</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED}
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {files.length > 0 && (
            <section className="file-section" aria-label="Source documents">
              <div className="section-bar">
                <h2>
                  Documents <span className="count-badge">{files.length}</span>
                </h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                  Clear all
                </button>
              </div>
              <ul className="file-list" aria-label="Source documents, in order">
                {files.map((entry, index) => (
                  <FileItem
                    key={entry.id}
                    entry={entry}
                    index={index}
                    total={files.length}
                    pageCount={pageCountsByFile.get(entry.id) ?? 0}
                    failed={docsRef.current.get(entry.id)?.failed}
                    canReorder={grouped}
                    onMove={moveDocument}
                    onRemove={removeFile}
                  />
                ))}
              </ul>

              <div className="output-settings">
                <label className="setting">
                  <span className="setting-label">Image quality</span>
                  <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                    {Object.values(QUALITY_PRESETS).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting">
                  <span className="setting-label">Page size</span>
                  <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                    {Object.values(PAGE_SIZES).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting setting-wide">
                  <span className="setting-label">File name</span>
                  <input
                    type="text"
                    value={fileName}
                    placeholder={buildDownloadName(files[0]?.name)}
                    onChange={(e) => setFileName(e.target.value)}
                  />
                </label>
              </div>

              <div className="merge-bar">
                <button type="button" className="btn btn-primary btn-merge" onClick={mergePdfs} disabled={merging || totalPages === 0}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Merge &amp; Download PDF
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''} total
                </span>
              </div>
            </section>
          )}
        </div>

        {files.length > 0 && (
          <section className="panel-right" aria-labelledby="preview-heading">
            <div className="preview-scroll">
              <div className="preview-header">
                <h2 id="preview-heading" className="preview-title">
                  Pages
                </h2>
                <span className="preview-pages">
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="reorder-hint">Drag a page to reorder, or use the buttons on each page</p>

              {totalPages === 0 ? (
                <p className="preview-empty">No pages yet.</p>
              ) : (
                <div className="preview-pages-list">
                  {pages.map((page, index) => (
                    <PageCard
                      key={page.id}
                      page={page}
                      index={index}
                      total={pages.length}
                      source={files.find((f) => f.id === page.fileId)}
                      getBitmap={getBitmap}
                      cropping={croppingId === page.id}
                      onStartCrop={() => setCroppingId(page.id)}
                      onCancelCrop={() => setCroppingId(null)}
                      onApplyCrop={onApplyCrop}
                      onRotate={onRotate}
                      onDelete={onDeletePage}
                      onMove={onMovePage}
                      isDragging={draggedId === page.id}
                      isDragTarget={dragTargetId === page.id}
                      onDragStart={onDragStart}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onItemDrop}
                      onDragEnd={onDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {merging && (
          <div className="progress-overlay" role="status" aria-live="polite" aria-busy="true">
            <div className="progress-card">
              <div className="spinner" aria-hidden="true" />
              <p className="progress-text">{progress || 'Working...'}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelMerge}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Live region for status announcements. Always mounted so updates are announced. */}
        <div className="sr-only" role="status" aria-live="polite">
          {liveMessage}
        </div>

        {toast && (
          <div
            className={`toast${toast.isError ? ' toast-error' : ''}`}
            role={toast.isError ? 'alert' : 'status'}
            aria-live={toast.isError ? 'assertive' : 'polite'}
          >
            {toast.message}
          </div>
        )}
      </main>
    </>
  );
}

// -- Source document row --

function FileItem({ entry, index, total, pageCount, failed, canReorder, onMove, onRemove }) {
  const isPdf = entry.type === 'application/pdf';
  const reorderTitle = canReorder
    ? undefined
    : 'Pages from this document are no longer together, so it cannot be moved as one block';

  return (
    <li className={`file-item${failed ? ' file-item-failed' : ''}`}>
      <span className="file-order" aria-hidden="true">
        {index + 1}
      </span>

      <div className={`file-thumb${isPdf ? ' pdf-thumb' : ''}`}>
        {entry.thumbUrl ? <img src={entry.thumbUrl} alt="" /> : 'PDF'}
      </div>

      <div className="file-info">
        <div className="file-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="file-meta">
          {failed
            ? 'Could not be read'
            : `${isPdf ? 'PDF' : (entry.type.split('/')[1] || 'IMG').toUpperCase()} · ${formatSize(entry.size)} · ${pageCount} page${pageCount !== 1 ? 's' : ''}`}
        </div>
      </div>

      <button
        type="button"
        className="move-btn"
        title={reorderTitle}
        aria-label={`Move ${entry.name} earlier`}
        onClick={() => onMove(entry.id, -1)}
        disabled={index === 0 || !canReorder}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="move-btn"
        title={reorderTitle}
        aria-label={`Move ${entry.name} later`}
        onClick={() => onMove(entry.id, 1)}
        disabled={index === total - 1 || !canReorder}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button type="button" className="file-remove" aria-label={`Remove ${entry.name}`} onClick={() => onRemove(entry.id)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

// -- One output page --

function PageCard({
  page,
  index,
  total,
  source,
  getBitmap,
  cropping,
  onStartCrop,
  onCancelCrop,
  onApplyCrop,
  onRotate,
  onDelete,
  onMove,
  isDragging,
  isDragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState(null);

  const label = `Page ${index + 1}`;
  const sourceLabel = source ? `${source.name} (p.${page.sourceIndex + 1})` : 'Unknown source';

  // Render only once the page is near the viewport: a 400-page document should not rasterise
  // 400 pages before the user has scrolled.
  useEffect(() => {
    if (visible) return undefined;
    const el = hostRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    getBitmap(page)
      .then((bm) => {
        if (alive) setBitmap(bm);
      })
      .catch((err) => {
        console.error('Preview failed:', sourceLabel, err);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // Only the source identity matters: rotation and crop are applied over the bitmap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page.fileId, page.sourceIndex, getBitmap]);

  useEffect(() => {
    if (!bitmap || !canvasRef.current) return;
    // While cropping, show the whole page so there is something to drag a box over.
    drawPage(canvasRef.current, bitmap, page.rotation, cropping ? null : page.crop);
  }, [bitmap, page.rotation, page.crop, cropping]);

  useEffect(() => {
    if (!cropping) setDraft(null);
  }, [cropping]);

  return (
    <div
      ref={hostRef}
      className={`preview-page${isDragging ? ' dragging' : ''}${isDragTarget ? ' drag-target' : ''}${cropping ? ' cropping' : ''}`}
      draggable={!cropping}
      onDragStart={() => onDragStart(page.id)}
      onDragOver={(e) => onDragOver(e, page.id)}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(page.id)}
      onDragEnd={onDragEnd}
    >
      <div className="preview-page-inner">
        {failed ? (
          <div className="preview-error">Could not render this page</div>
        ) : (
          <>
            <canvas ref={canvasRef} className="preview-canvas" role="img" aria-label={`${label} of ${sourceLabel}`} />
            {!bitmap && (
              <div className="preview-loading">
                <div className="spinner-sm" aria-hidden="true" />
                <span className="preview-loading-text">Rendering...</span>
              </div>
            )}
            {cropping && bitmap && <CropLayer draft={draft} onDraft={setDraft} />}
          </>
        )}
      </div>

      {cropping ? (
        <div className="crop-actions">
          <span className="crop-hint">{draft ? 'Drag again to redraw' : 'Drag a box over the page'}</span>
          {page.crop && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApplyCrop(page.id, null)}>
              Clear crop
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelCrop}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!draft} onClick={() => onApplyCrop(page.id, draft)}>
            Apply crop
          </button>
        </div>
      ) : (
        <div className="page-bar">
          <span className="preview-page-num">
            {label}
            {!isPristine(page) && (
              <span className="page-edited" title="This page has been rotated or cropped">
                {' '}
                &middot; edited
              </span>
            )}
          </span>

          <div className="page-controls">
            <button type="button" className="page-btn" aria-label={`Rotate ${label} left`} onClick={() => onRotate(page.id, -90)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Rotate ${label} right`} onClick={() => onRotate(page.id, 90)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Crop ${label}`} onClick={onStartCrop}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M6 2v14a2 2 0 0 0 2 2h14" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18 22V8a2 2 0 0 0-2-2H2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Move ${label} up`} onClick={() => onMove(page.id, -1)} disabled={index === 0}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Move ${label} down`} onClick={() => onMove(page.id, 1)} disabled={index === total - 1}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn page-btn-danger" aria-label={`Remove ${label}`} onClick={() => onDelete(page.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <span className="preview-page-source" title={sourceLabel}>
            {sourceLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// -- Crop rectangle --

// Drag a box over the page. Coordinates are kept as 0..1 fractions of the displayed page, so
// they mean the same thing whatever the preview is scaled to - and the same thing to the
// merge, which applies them to the full-resolution source.
function CropLayer({ draft, onDraft }) {
  const layerRef = useRef(null);
  const startRef = useRef(null);

  const pointFrom = (event) => {
    const rect = layerRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    // Capture keeps the drag alive if the pointer leaves the page box. It is an enhancement,
    // not a requirement — never let its absence break cropping.
    try {
      layerRef.current.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture unavailable */
    }
    startRef.current = pointFrom(event);
    onDraft(null);
  };

  const onPointerMove = (event) => {
    if (!startRef.current) return;
    const start = startRef.current;
    const now = pointFrom(event);
    onDraft({
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      width: Math.abs(now.x - start.x),
      height: Math.abs(now.y - start.y),
    });
  };

  const onPointerUp = (event) => {
    if (!startRef.current) return;
    startRef.current = null;
    try {
      layerRef.current.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    // Ignore an accidental click: too small a box would crop the page to nothing.
    if (draft && (draft.width < 0.02 || draft.height < 0.02)) onDraft(null);
  };

  const style = draft
    ? {
        left: `${draft.x * 100}%`,
        top: `${draft.y * 100}%`,
        width: `${draft.width * 100}%`,
        height: `${draft.height * 100}%`,
      }
    : null;

  return (
    <div
      ref={layerRef}
      className="crop-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {style && <div className="crop-rect" style={style} />}
    </div>
  );
}
