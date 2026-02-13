'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

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
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

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
          } catch {
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
          pages.forEach((page) => mergedPdf.addPage(page));
        } else {
          let image;
          if (entry.type === 'image/png') {
            image = await mergedPdf.embedPng(arrayBuffer);
          } else if (entry.type === 'image/webp') {
            const jpgBuf = await convertToJpg(entry.file);
            image = await mergedPdf.embedJpg(jpgBuf);
          } else {
            image = await mergedPdf.embedJpg(arrayBuffer);
          }
          const { width, height } = image.scale(1);
          const page = mergedPdf.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });
        }
      }

      setProgress('Generating PDF...');
      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.pdf';
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
    <div className="layout">
      {/* ── LEFT PANEL: Upload + File List ── */}
      <div className="panel-left">
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

      {/* ── RIGHT PANEL: Combined Preview ── */}
      <div className="panel-right" ref={previewRef}>
        {files.length === 0 ? (
          <div className="preview-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p>Preview will appear here</p>
            <span>Upload files to see a combined preview</span>
          </div>
        ) : (
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

function convertToJpg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas conversion failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        },
        'image/jpeg',
        0.92,
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}
