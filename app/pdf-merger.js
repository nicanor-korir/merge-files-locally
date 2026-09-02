'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
import { describeSkipped, mergeDocuments } from '../lib/merge';

export default function PdfMerger() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]); // { fileId, pageIndex, dataUrl, label }
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState('');
  const [toast, setToast] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [dragOverZone, setDragOverZone] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);
  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const previewRef = useRef(null);
  // Mirror of `files` so the unmount cleanup can revoke object URLs without re-subscribing.
  const filesRef = useRef(files);
  filesRef.current = files;

  // Revoke any outstanding thumbnail object URLs when the component unmounts.
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      });
    };
  }, []);

  // ── Toast ──

  const showToast = useCallback((msg, isError = false) => {
    setToast({ message: msg, isError });
    clearTimeout(toastTimer.current);
    // Errors linger a little longer so they can be read.
    toastTimer.current = setTimeout(() => setToast(null), isError ? 5000 : 2500);
  }, []);

  // Announce a transient status to screen readers. A leading zero-width space forces the
  // live region to change even when the same message repeats (e.g. moving a file twice),
  // so it is re-announced.
  const announce = useCallback((msg) => {
    setLiveMessage((prev) => (prev === msg ? `​${msg}` : msg));
  }, []);

  // ── Generate previews whenever files change ──

  useEffect(() => {
    let cancelled = false;

    async function generatePreviews() {
      if (files.length === 0) {
        setPreviews([]);
        return;
      }

      const allPreviews = [];
      let globalPage = 0;

      for (const entry of files) {
        if (cancelled) return;

        if (entry.type === 'application/pdf') {
          let loadingTask = null;
          let pdf = null;
          try {
            const arrayBuffer = await entry.file.arrayBuffer();
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
            const pdfjsLib = pdfjs.default || pdfjs;
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
              pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
            }
            // isEvalSupported: false mitigates CVE-2024-4367 (arbitrary JS execution from a
            // crafted PDF via font handling) when rendering untrusted, user-supplied PDFs.
            loadingTask = pdfjsLib.getDocument({
              data: new Uint8Array(arrayBuffer),
              isEvalSupported: false,
            });
            pdf = await loadingTask.promise;

            for (let p = 1; p <= pdf.numPages; p++) {
              if (cancelled) break;
              globalPage++;
              const page = await pdf.getPage(p);
              const scale = 1.2;
              const viewport = page.getViewport({ scale });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const ctx = canvas.getContext('2d');
              await page.render({ canvasContext: ctx, viewport }).promise;
              allPreviews.push({
                fileId: entry.id,
                fileName: entry.name,
                pageIndex: p,
                totalPages: pdf.numPages,
                globalPage,
                dataUrl: canvas.toDataURL('image/jpeg', 0.7),
                width: viewport.width,
                height: viewport.height,
              });
            }
          } catch (err) {
            console.error('PDF preview failed:', entry.name, err);
            globalPage++;
            allPreviews.push({
              fileId: entry.id,
              fileName: entry.name,
              pageIndex: 1,
              totalPages: 1,
              globalPage,
              dataUrl: null,
              error: true,
            });
          } finally {
            // Tear down pdf.js work so a superseded run doesn't keep rendering in the background.
            try { await pdf?.cleanup?.(); } catch { /* ignore */ }
            try { await loadingTask?.destroy?.(); } catch { /* ignore */ }
          }
        } else {
          globalPage++;
          allPreviews.push({
            fileId: entry.id,
            fileName: entry.name,
            pageIndex: 1,
            totalPages: 1,
            globalPage,
            dataUrl: entry.thumbUrl,
            isImage: true,
          });
        }
      }

      if (!cancelled) {
        setPreviews(allPreviews);
      }
    }

    generatePreviews();
    return () => { cancelled = true; };
  }, [files]);

  // ── Add files ──

  const addFiles = useCallback((fileList) => {
    const newEntries = [];
    let skippedUnsupported = 0;
    let skippedEmpty = 0;

    for (const file of fileList) {
      if (!isAcceptedFile(file)) {
        skippedUnsupported++;
        continue;
      }
      if (file.size === 0) {
        skippedEmpty++;
        continue;
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
      showToast(`${skippedUnsupported} file${skippedUnsupported > 1 ? 's' : ''} skipped (unsupported format)`);
    } else if (skippedEmpty > 0) {
      showToast(`${skippedEmpty} empty file${skippedEmpty > 1 ? 's' : ''} skipped`);
    }
    if (newEntries.length > 0) {
      const next = [...filesRef.current, ...newEntries];
      setFiles(next);
      // Soft warning: large batches are processed entirely in-memory and can hang or
      // crash the tab. We don't block — just let the user know.
      const totalBytes = next.reduce((sum, f) => sum + f.size, 0);
      if (next.length > LARGE_FILE_COUNT || totalBytes > LARGE_TOTAL_BYTES) {
        showToast('Large selection — merging may take a while or use a lot of memory.', true);
      }
    }
  }, [showToast]);

  // ── Remove / Clear ──

  const removeFile = useCallback((id) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry?.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
      if (entry) announce(`Removed ${entry.name}`);
      return prev.filter((f) => f.id !== id);
    });
  }, [announce]);

  const clearAll = useCallback(() => {
    const current = filesRef.current;
    if (current.length === 0) return;
    // Guard against accidental loss of the whole queue.
    if (typeof window !== 'undefined' && !window.confirm(`Remove all ${current.length} files?`)) {
      return;
    }
    current.forEach((f) => { if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl); });
    announce('Cleared all files');
    setFiles([]);
  }, [announce]);

  // ── Drop zone ──

  const onDropZoneDrop = useCallback((e) => {
    e.preventDefault();
    setDragOverZone(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // ── Drag reorder ──

  const onDragStart = useCallback((id) => setDraggedId(id), []);

  const onDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggedId) setDragTargetId(id);
  }, [draggedId]);

  const onDragLeave = useCallback(() => setDragTargetId(null), []);

  const onItemDrop = useCallback((targetId) => {
    setDragTargetId(null);
    if (!draggedId || targetId === draggedId) return;
    setFiles((prev) => {
      const copy = [...prev];
      const fromIdx = copy.findIndex((f) => f.id === draggedId);
      const toIdx = copy.findIndex((f) => f.id === targetId);
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
    setDraggedId(null);
  }, [draggedId]);

  const onDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragTargetId(null);
  }, []);

  const moveFile = useCallback((id, direction) => {
    setFiles((prev) => {
      const copy = [...prev];
      const idx = copy.findIndex((f) => f.id === id);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= copy.length) return prev;
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      announce(`Moved ${copy[newIdx].name} to position ${newIdx + 1} of ${copy.length}`);
      return copy;
    });
  }, [announce]);

  // ── Merge & Download ──

  const mergePdfs = useCallback(async () => {
    if (files.length === 0) return;
    setMerging(true);

    try {
      const downloadName = buildDownloadName(files[0]?.name);
      const { bytes, skipped } = await mergeDocuments(files, {
        compressImage,
        onProgress: setProgress,
        title: downloadName,
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
        // Surfaced as an error toast so it lingers and is announced assertively — a silently
        // dropped file is exactly what the user needs to hear about.
        showToast(
          `Merged. Skipped ${skipped.length} file${skipped.length > 1 ? 's' : ''}: ${describeSkipped(skipped)}`,
          true,
        );
      } else {
        showToast('PDF merged and downloaded!');
      }
    } catch (err) {
      console.error('Merge failed:', err);
      showToast('Merge failed: ' + err.message, true);
    } finally {
      setMerging(false);
      setProgress('');
    }
  }, [files, showToast]);

  const totalPages = previews.length;

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
            <p>Merge PDFs &amp; images locally — your files never leave your device.</p>
          </div>
          <div className="header-actions">
            {files.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-header-merge"
                onClick={mergePdfs}
                disabled={merging}
              >
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
      {/* ── LEFT PANEL: Upload + File List ── */}
      <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
        {/* Drop zone — drag/drop is a mouse affordance; the "browse" button is the
            keyboard/AT entry point, so this wrapper is not itself a button. */}
        <div
          className={`drop-zone${dragOverZone ? ' drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOverZone(true); }}
          onDragLeave={() => setDragOverZone(false)}
          onDrop={onDropZoneDrop}
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
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
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
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <section className="file-section" aria-label="Selected files">
            <div className="section-bar">
              <h2>
                Files <span className="count-badge">{files.length}</span>
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                Clear all
              </button>
            </div>
            <p className="reorder-hint">Drag to reorder, or use the arrow buttons</p>
            <ul className="file-list" aria-label="Files to merge, in order">
              {files.map((entry, index) => (
                <FileItem
                  key={entry.id}
                  entry={entry}
                  index={index}
                  total={files.length}
                  isDragging={draggedId === entry.id}
                  isDragTarget={dragTargetId === entry.id}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onItemDrop}
                  onDragEnd={onDragEnd}
                  onRemove={removeFile}
                  onMove={moveFile}
                />
              ))}
            </ul>

            <div className="merge-bar">
              <button
                type="button"
                className="btn btn-primary btn-merge"
                onClick={mergePdfs}
                disabled={merging}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Merge &amp; Download PDF
              </button>
              <span className="merge-meta">{totalPages} page{totalPages !== 1 ? 's' : ''} total</span>
            </div>
          </section>
        )}
      </div>

      {/* ── RIGHT PANEL: Combined Preview (hidden when no files) ── */}
      {files.length > 0 && (
      <section className="panel-right" ref={previewRef} aria-labelledby="preview-heading">
        <div className="preview-scroll">
          <div className="preview-header">
            <h2 id="preview-heading" className="preview-title">Combined Preview</h2>
            <span className="preview-pages">{totalPages} page{totalPages !== 1 ? 's' : ''}</span>
          </div>
          <div className="preview-pages-list">
            {previews.map((p) => (
              <div key={`${p.fileId}-${p.pageIndex}`} className="preview-page">
                <div className="preview-page-inner">
                  {p.error ? (
                    <div className="preview-error">Could not render PDF</div>
                  ) : p.dataUrl ? (
                    <img src={p.dataUrl} alt={`Page ${p.globalPage} of ${p.fileName}`} className="preview-img" />
                  ) : (
                    <div className="preview-loading">
                      <div className="spinner-sm" aria-hidden="true" />
                      <span className="preview-loading-text">Rendering…</span>
                    </div>
                  )}
                </div>
                <div className="preview-page-label">
                  <span className="preview-page-num">Page {p.globalPage}</span>
                  <span className="preview-page-source" title={p.fileName}>
                    {p.fileName}{p.totalPages > 1 ? ` (p.${p.pageIndex})` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Progress overlay — announced to assistive tech */}
      {merging && (
        <div className="progress-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="progress-card">
            <div className="spinner" aria-hidden="true" />
            <p className="progress-text">{progress || 'Working…'}</p>
          </div>
        </div>
      )}

      {/* Live region for status announcements (reorder, clear). Always mounted so updates
          are reliably announced. */}
      <div className="sr-only" role="status" aria-live="polite">{liveMessage}</div>

      {/* Toast — polite for info, assertive for errors */}
      {toast && (
        <div className={`toast${toast.isError ? ' toast-error' : ''}`} role={toast.isError ? 'alert' : 'status'} aria-live={toast.isError ? 'assertive' : 'polite'}>
          {toast.message}
        </div>
      )}
    </main>
    </>
  );
}

// ── File Item Component ──

function FileItem({ entry, index, total, isDragging, isDragTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onRemove, onMove }) {
  const isPdf = entry.type === 'application/pdf';

  return (
    <li
      className={`file-item${isDragging ? ' dragging' : ''}${isDragTarget ? ' drag-target' : ''}`}
      draggable
      onDragStart={() => onDragStart(entry.id)}
      onDragOver={(e) => onDragOver(e, entry.id)}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(entry.id)}
      onDragEnd={onDragEnd}
    >
      <span className="drag-handle" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="5.5" cy="3" r="1.2" />
          <circle cx="10.5" cy="3" r="1.2" />
          <circle cx="5.5" cy="8" r="1.2" />
          <circle cx="10.5" cy="8" r="1.2" />
          <circle cx="5.5" cy="13" r="1.2" />
          <circle cx="10.5" cy="13" r="1.2" />
        </svg>
      </span>

      <span className="file-order" aria-hidden="true">{index + 1}</span>

      <div className={`file-thumb${isPdf ? ' pdf-thumb' : ''}`}>
        {entry.thumbUrl ? <img src={entry.thumbUrl} alt="" /> : 'PDF'}
      </div>

      <div className="file-info">
        <div className="file-name" title={entry.name}>{entry.name}</div>
        <div className="file-meta">
          {isPdf ? 'PDF' : (entry.type.split('/')[1] || 'IMG').toUpperCase()} &middot; {formatSize(entry.size)}
        </div>
      </div>

      <button type="button" className="move-btn" aria-label={`Move ${entry.name} up`} onClick={() => onMove(entry.id, -1)} disabled={index === 0}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="move-btn" aria-label={`Move ${entry.name} down`} onClick={() => onMove(entry.id, 1)} disabled={index === total - 1}>
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
