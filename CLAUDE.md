# CLAUDE.md

## Project Overview

A local-first web app for merging PDFs and images into a single PDF document. All processing happens client-side in the browser — no files are ever uploaded to a server.

## Tech Stack

- **Framework**: Next.js 15 (App Router, static export)
- **Language**: JavaScript (React 19)
- **PDF Merge**: pdf-lib (creating/merging PDFs)
- **PDF Preview**: pdfjs-dist (rendering PDF pages to canvas)
- **Styling**: Plain CSS (no CSS framework)

## Project Structure

```
app/
  layout.js        — Root layout with metadata
  globals.css      — All styles (CSS custom properties, two-column layout)
  page.js          — Server component: header + PdfMerger
  pdf-merger.js    — Client component: upload, file list, preview, merge logic
next.config.mjs    — Next.js config (static export, canvas alias for pdfjs)
```

## Commands

```bash
npm run dev       # Start dev server (http://localhost:3000)
npm run build     # Production build (static export to out/)
npm run start     # Serve production build
```

## Architecture Notes

- The app uses `output: 'export'` to produce a fully static site (no Node.js server needed in production)
- `pdf-merger.js` is a `'use client'` component — all file handling, preview generation, and PDF merging run in the browser
- PDF pages are rendered via pdfjs-dist using offscreen canvases, converted to JPEG data URLs for the preview
- WebP images are converted to JPEG via canvas before embedding (pdf-lib doesn't support WebP natively)
- The `canvas` Node.js module is aliased to `false` in webpack config since pdfjs-dist only needs browser Canvas API

## Key Design Decisions

- Two-column layout: left panel for upload + file management, right panel for live combined preview
- Files can be reordered via drag-and-drop or up/down arrow buttons
- Preview regenerates automatically when files change (add, remove, reorder)
- No external UI libraries — keeps bundle small and avoids dependency bloat
