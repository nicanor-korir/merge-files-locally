'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

// Name the downloaded file after the first merged file, e.g. "report.pdf" → "report-merged.pdf"
function buildDownloadName(firstName) {
  const base = (firstName || 'merged').replace(/\.[^.]+$/, '').trim();
  return `${base || 'merged'}-merged.pdf`;
}

export default function PdfMerger() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]); // { fileId, pageIndex, dataUrl, label }
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState('');
  const [toast, setToast] = useState(null);
  const [dragOverZone, setDragOverZone] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);
  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const previewRef = useRef(null);

  // ── Toast ──

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
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
          try {
            const arrayBuffer = await entry.file.arrayBuffer();
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
            const pdfjsLib = pdfjs.default || pdfjs;
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
              pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
            }
            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
            const pdf = await loadingTask.promise;

            for (let p = 1; p <= pdf.numPages; p++) {
              if (cancelled) return;
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
    let skipped = 0;

    for (const file of fileList) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        skipped++;
        continue;
      }
      newEntries.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        thumbUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }

    if (skipped > 0) {
      showToast(`${skipped} file${skipped > 1 ? 's' : ''} skipped (unsupported format)`);
    }
    if (newEntries.length > 0) {
      setFiles((prev) => [...prev, ...newEntries]);
    }
  }, [showToast]);

  // ── Remove / Clear ──

  const removeFile = useCallback((id) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry?.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => { if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl); });
      return [];
    });
  }, []);

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
      return copy;
    });
  }, []);

  // ── Merge & Download ──

  const mergePdfs = useCallback(async () => {
    if (files.length === 0) return;
    setMerging(true);

    try {
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        setProgress(`Processing ${i + 1} of ${files.length}: ${entry.name}`);
        const arrayBuffer = await entry.file.arrayBuffer();

        if (entry.type === 'application/pdf') {
          const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
          pages.forEach((page) => {
            // Scale PDF pages to A4 width while preserving aspect ratio
            const A4_WIDTH = 595.28;
            const A4_HEIGHT = 841.89;
            const { width, height } = page.getSize();
            const scale = A4_WIDTH / width;
            const newHeight = height * scale;
            page.setSize(A4_WIDTH, Math.max(newHeight, A4_HEIGHT));
            page.scaleContent(scale, scale);
            // Reposition content to top of page
            if (newHeight < A4_HEIGHT) {
              page.translateContent(0, A4_HEIGHT - newHeight);
            }
            mergedPdf.addPage(page);
          });
        } else {
          // Convert all images to compressed JPEG for smaller file size
          const jpgBuf = await compressImage(entry.file);
          const image = await mergedPdf.embedJpg(jpgBuf);
          // Scale image to fit A4 width, maintain aspect ratio
          const A4_WIDTH = 595.28;
          const A4_HEIGHT = 841.89;
          const { width: imgW, height: imgH } = image.scale(1);
          const scale = A4_WIDTH / imgW;
          const scaledHeight = imgH * scale;
          const pageHeight = Math.max(scaledHeight, A4_HEIGHT);
          const page = mergedPdf.addPage([A4_WIDTH, pageHeight]);
          // Draw image at top of page
          page.drawImage(image, {
            x: 0,
            y: pageHeight - scaledHeight,
            width: A4_WIDTH,
            height: scaledHeight,
          });
        }
      }

      setProgress('Compressing PDF...');
      const pdfBytes = await mergedPdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
      });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildDownloadName(files[0]?.name);
      a.click();
      URL.revokeObjectURL(url);

      showToast('PDF merged and downloaded!');
    } catch (err) {
      console.error('Merge failed:', err);
      showToast('Merge failed: ' + err.message);
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Merge &amp; Download
              </button>
            )}
            <div className="privacy-badge">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Private
            </div>
          </div>
        </div>
      </header>
      <div className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
      {/* ── LEFT PANEL: Upload + File List ── */}
      <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
        {/* Drop zone */}
        <div
          className={`drop-zone${dragOverZone ? ' drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOverZone(true); }}
          onDragLeave={() => setDragOverZone(false)}
          onDrop={onDropZoneDrop}
          tabIndex={0}
          role="button"
          aria-label="Upload files"
        >
          <svg className="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 8l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="drop-zone-text">
            Drop files here or{' '}
            <button type="button" className="browse-link" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
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
          <section className="file-section">
            <div className="section-bar">
              <h2>
                Files <span className="count-badge">{files.length}</span>
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                Clear all
              </button>
            </div>
            <p className="reorder-hint">Drag to reorder</p>
            <ul className="file-list">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
      <div className="panel-right" ref={previewRef}>
        {(
          <div className="preview-scroll">
            <div className="preview-header">
              <span className="preview-title">Combined Preview</span>
              <span className="preview-pages">{totalPages} page{totalPages !== 1 ? 's' : ''}</span>
            </div>
            <div className="preview-pages-list">
              {previews.map((p, i) => (
                <div key={`${p.fileId}-${p.pageIndex}`} className="preview-page">
                  <div className="preview-page-inner">
                    {p.error ? (
                      <div className="preview-error">Could not render PDF</div>
                    ) : p.dataUrl ? (
                      <img src={p.dataUrl} alt={`Page ${p.globalPage}`} className="preview-img" />
                    ) : (
                      <div className="preview-loading"><div className="spinner-sm" /></div>
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
        )}
      </div>
      )}

      {/* Progress overlay */}
      {merging && (
        <div className="progress-overlay">
          <div className="progress-card">
            <div className="spinner" />
            <p className="progress-text">{progress}</p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
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
      <span className="drag-handle" title="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5.5" cy="3" r="1.2" />
          <circle cx="10.5" cy="3" r="1.2" />
          <circle cx="5.5" cy="8" r="1.2" />
          <circle cx="10.5" cy="8" r="1.2" />
          <circle cx="5.5" cy="13" r="1.2" />
          <circle cx="10.5" cy="13" r="1.2" />
        </svg>
      </span>

      <span className="file-order">{index + 1}</span>

      <div className={`file-thumb${isPdf ? ' pdf-thumb' : ''}`}>
        {entry.thumbUrl ? <img src={entry.thumbUrl} alt="" /> : 'PDF'}
      </div>

      <div className="file-info">
        <div className="file-name" title={entry.name}>{entry.name}</div>
        <div className="file-meta">
          {isPdf ? 'PDF' : entry.type.split('/')[1].toUpperCase()} &middot; {formatSize(entry.size)}
        </div>
      </div>

      <button type="button" className="move-btn" title="Move up" onClick={() => onMove(entry.id, -1)} disabled={index === 0}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="move-btn" title="Move down" onClick={() => onMove(entry.id, 1)} disabled={index === total - 1}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button type="button" className="file-remove" title="Remove file" onClick={() => onRemove(entry.id)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function compressImage(file, maxDimension = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;

      // Scale down large images
      if (w > maxDimension || h > maxDimension) {
        const ratio = Math.min(maxDimension / w, maxDimension / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas conversion failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        },
        'image/jpeg',
        quality,
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}
