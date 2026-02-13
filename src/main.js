import './style.css';
import { PDFDocument } from 'pdf-lib';

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

let files = []; // { id, file, name, size, type, thumbUrl }

// DOM elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileListSection = document.getElementById('file-list-section');
const fileList = document.getElementById('file-list');
const fileCount = document.getElementById('file-count');
const clearBtn = document.getElementById('clear-btn');
const mergeBtn = document.getElementById('merge-btn');
const progressOverlay = document.getElementById('progress-overlay');
const progressText = document.getElementById('progress-text');

// ── File Upload ──

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// Drag & drop onto the drop zone
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles(e.dataTransfer.files);
});

// ── Add files ──

function addFiles(fileListInput) {
  for (const file of fileListInput) {
    if (!ACCEPTED_TYPES.includes(file.type)) continue;

    const entry = {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      thumbUrl: null,
    };

    // Generate thumbnail for images
    if (file.type.startsWith('image/')) {
      entry.thumbUrl = URL.createObjectURL(file);
    }

    files.push(entry);
  }

  renderFileList();
}

// ── Render ──

function renderFileList() {
  fileListSection.classList.toggle('hidden', files.length === 0);
  fileCount.textContent = files.length;

  fileList.innerHTML = '';

  files.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.id = entry.id;
    li.draggable = true;

    const isPdf = entry.type === 'application/pdf';
    const thumbContent = entry.thumbUrl
      ? `<img src="${entry.thumbUrl}" alt="" />`
      : 'PDF';

    li.innerHTML = `
      <span class="file-order">${index + 1}</span>
      <span class="drag-handle" title="Drag to reorder">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5.5" cy="3.5" r="1.2"/>
          <circle cx="10.5" cy="3.5" r="1.2"/>
          <circle cx="5.5" cy="8" r="1.2"/>
          <circle cx="10.5" cy="8" r="1.2"/>
          <circle cx="5.5" cy="12.5" r="1.2"/>
          <circle cx="10.5" cy="12.5" r="1.2"/>
        </svg>
      </span>
      <div class="file-thumb">${thumbContent}</div>
      <div class="file-info">
        <div class="file-name" title="${entry.name}">${entry.name}</div>
        <div class="file-meta">${isPdf ? 'PDF' : entry.type.split('/')[1].toUpperCase()} &middot; ${formatSize(entry.size)}</div>
      </div>
      <button type="button" class="file-remove" title="Remove file" data-id="${entry.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    fileList.appendChild(li);
  });

  setupDragAndDrop();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Remove / Clear ──

fileList.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.file-remove');
  if (!removeBtn) return;
  const id = removeBtn.dataset.id;
  const entry = files.find((f) => f.id === id);
  if (entry?.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
  files = files.filter((f) => f.id !== id);
  renderFileList();
});

clearBtn.addEventListener('click', () => {
  files.forEach((f) => {
    if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
  });
  files = [];
  renderFileList();
});

// ── Drag & Drop Reorder ──

let draggedId = null;

function setupDragAndDrop() {
  const items = fileList.querySelectorAll('.file-item');

  items.forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      draggedId = item.dataset.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      draggedId = null;
      item.classList.remove('dragging');
      fileList.querySelectorAll('.file-item').forEach((el) => el.classList.remove('drag-target'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item.dataset.id !== draggedId) {
        item.classList.add('drag-target');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-target');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-target');
      if (!draggedId || item.dataset.id === draggedId) return;

      const fromIndex = files.findIndex((f) => f.id === draggedId);
      const toIndex = files.findIndex((f) => f.id === item.dataset.id);

      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);

      renderFileList();
    });
  });

  // Touch-based reordering
  items.forEach((item) => {
    const handle = item.querySelector('.drag-handle');
    let touchStartY = 0;
    let currentElement = null;

    handle.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
      draggedId = item.dataset.id;
      item.classList.add('dragging');
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetItem = target?.closest('.file-item');

      fileList.querySelectorAll('.file-item').forEach((el) => el.classList.remove('drag-target'));

      if (targetItem && targetItem.dataset.id !== draggedId) {
        targetItem.classList.add('drag-target');
        currentElement = targetItem;
      }
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      item.classList.remove('dragging');
      fileList.querySelectorAll('.file-item').forEach((el) => el.classList.remove('drag-target'));

      if (currentElement && currentElement.dataset.id !== draggedId) {
        const fromIndex = files.findIndex((f) => f.id === draggedId);
        const toIndex = files.findIndex((f) => f.id === currentElement.dataset.id);

        const [moved] = files.splice(fromIndex, 1);
        files.splice(toIndex, 0, moved);

        renderFileList();
      }

      draggedId = null;
      currentElement = null;
    });
  });
}

// ── Merge & Download ──

mergeBtn.addEventListener('click', async () => {
  if (files.length === 0) return;

  showProgress('Merging files...');

  try {
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      showProgress(`Processing ${i + 1} of ${files.length}: ${entry.name}`);

      const arrayBuffer = await entry.file.arrayBuffer();

      if (entry.type === 'application/pdf') {
        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      } else {
        // Image: embed and add as a page
        let image;
        if (entry.type === 'image/png') {
          image = await mergedPdf.embedPng(arrayBuffer);
        } else {
          // JPG and WebP — for WebP we convert via canvas
          if (entry.type === 'image/webp') {
            const jpgBuffer = await convertToJpg(entry.file);
            image = await mergedPdf.embedJpg(jpgBuffer);
          } else {
            image = await mergedPdf.embedJpg(arrayBuffer);
          }
        }

        const { width, height } = image.scale(1);
        const page = mergedPdf.addPage([width, height]);
        page.drawImage(image, { x: 0, y: 0, width, height });
      }
    }

    showProgress('Generating PDF...');
    const pdfBytes = await mergedPdf.save();

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.pdf';
    a.click();
    URL.revokeObjectURL(url);

    hideProgress();
  } catch (err) {
    hideProgress();
    console.error('Merge failed:', err);
    alert('Merge failed: ' + err.message);
  }
});

function convertToJpg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      // White background for transparency
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas conversion failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        },
        'image/jpeg',
        0.92
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

// ── Progress ──

function showProgress(text) {
  progressText.textContent = text;
  progressOverlay.classList.remove('hidden');
}

function hideProgress() {
  progressOverlay.classList.add('hidden');
}
