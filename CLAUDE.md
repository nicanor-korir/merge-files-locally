# CLAUDE.md

## Project Overview

A local-first web application for merging PDFs and images into a single PDF document. All processing happens entirely client-side in the browser — no files are ever uploaded to a server. Privacy-focused by design.

## Tech Stack

- **Framework**: Next.js 15 (App Router, static export)
- **Language**: JavaScript (React 19)
- **PDF Creation/Merging**: pdf-lib
- **PDF Preview Rendering**: pdfjs-dist
- **Styling**: Plain CSS with CSS custom properties (no framework)

## Project Structure

```
app/
  layout.js        — Root layout with metadata and global styles
  globals.css      — All styles (CSS custom properties, responsive layout)
  page.js          — Simple wrapper that renders PdfMerger
  pdf-merger.js    — Main client component with all application logic
next.config.mjs    — Next.js config (static export, webpack canvas alias)
CLAUDE.md          — Project documentation for AI assistants
PROMPT.md          — Original requirements and feature requests
```

## Commands

```bash
npm run dev       # Start development server (http://localhost:3000)
npm run build     # Production build (static export to out/)
npm run start     # Serve production build locally
```

## Architecture Notes

### Static Export
- Uses `output: 'export'` in Next.js config for fully static site generation
- No Node.js server required in production — can be hosted on any static file server
- Build outputs to `out/` directory

### Client-Side Processing
- `pdf-merger.js` is marked with `'use client'` directive
- All file handling, preview generation, and PDF merging runs in the browser
- Uses Web APIs: File API, Canvas API, Blob, URL.createObjectURL

### PDF Handling
- **pdf-lib**: Creates new PDFs, embeds images, copies pages from existing PDFs
- **pdfjs-dist**: Renders PDF pages to canvas for preview thumbnails
- Worker disabled (`workerSrc = undefined`) for simpler bundling

### Image Processing
- All images (PNG, JPG, WebP) converted to compressed JPEG before embedding
- Images scaled down to max 1600px dimension to reduce file size
- WebP requires canvas conversion since pdf-lib doesn't support it natively

### Webpack Configuration
- `canvas` Node.js module aliased to `false` (pdfjs-dist only needs browser Canvas API)

## Key Features

### Layout States
- **Empty state**: Centered drop zone, no preview panel
- **With files**: Two-column layout — file list on left, combined preview on right

### File Management
- Drag-and-drop file upload
- Click to browse files
- Reorder via drag-and-drop or up/down arrow buttons
- Remove individual files or clear all
- Shows file thumbnails, names, types, and sizes

### Preview
- Live combined preview showing all pages in merge order
- PDF pages rendered via pdfjs-dist at 1.2x scale
- Images displayed directly from object URLs
- Page numbers and source file labels

### PDF Output
- All pages normalized to A4 width (595.28pt)
- Aspect ratio preserved, content positioned at top
- Images compressed to JPEG at 75% quality
- PDF object streams enabled for smaller file size

## Code Patterns

### State Management
```javascript
const [files, setFiles] = useState([]);      // File entries with metadata
const [previews, setPreviews] = useState([]); // Generated preview data
const [merging, setMerging] = useState(false); // Merge in progress
const [progress, setProgress] = useState('');  // Progress message
```

### File Entry Structure
```javascript
{
  id: crypto.randomUUID(),
  file: File,           // Original File object
  name: string,         // File name
  size: number,         // File size in bytes
  type: string,         // MIME type
  thumbUrl: string|null // Object URL for image thumbnails
}
```

### Preview Entry Structure
```javascript
{
  fileId: string,       // Links to file entry
  fileName: string,
  pageIndex: number,    // Page number within source file
  totalPages: number,   // Total pages in source file
  globalPage: number,   // Page number in merged output
  dataUrl: string,      // Base64 JPEG data URL
  isImage?: boolean,
  error?: boolean
}
```

## Styling Conventions

- CSS custom properties defined in `:root`
- BEM-lite class naming (e.g., `.file-item`, `.preview-page-label`)
- Responsive breakpoints at 860px and 520px
- Transitions use `--transition: 180ms ease`
- Border radius uses `--radius`, `--radius-sm`, `--radius-xs`

## Important Constraints

- No server-side code — everything runs in browser
- No external UI libraries — keep bundle small
- No file uploads — privacy is a core feature
- Support PDF, PNG, JPG, JPEG, WebP only
- Must work offline after initial page load
