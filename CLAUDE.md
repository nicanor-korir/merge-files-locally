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
  layout.js        — Root layout: metadata, CSP <meta>, global styles
  globals.css      — All styles (CSS custom properties, responsive layout, a11y utilities)
  page.js          — Simple wrapper that renders PdfMerger
  pdf-merger.js    — Main client component with all application logic
scripts/
  copy-pdf-worker.mjs — Copies pdf.js worker into public/ (postinstall + prebuild)
public/
  pdf.worker.min.js   — pdf.js worker (generated; kept in sync with pdfjs-dist)
next.config.mjs    — Next.js config (static export, webpack canvas alias)
vercel.json        — Security headers + CSP for Vercel hosting
CLAUDE.md          — Project documentation for AI assistants
PROMPT.md          — Original requirements and feature requests
```

## Commands

The project uses **Bun** as the package manager (`bun.lock`); npm scripts work too.

```bash
bun install            # Install deps (runs postinstall: copies pdf.js worker into public/)
bun run dev            # Start development server (http://localhost:3000)
bun run build          # Production build (runs prebuild worker-copy, exports to out/)
bun run start          # Serve production build locally
bun run copy-pdf-worker # Manually re-copy the pdf.js worker (rarely needed)
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
- **pdfjs-dist** (pinned to `3.11.174`): Renders PDF pages to canvas for preview thumbnails
- **Worker**: enabled and served as a static file. `pdf-merger.js` sets
  `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'`. That file lives in `public/` and is
  produced by `scripts/copy-pdf-worker.mjs`, which copies the worker out of the installed
  `pdfjs-dist` on `postinstall` and `prebuild` so the two never drift (a version mismatch
  makes pdf.js throw `"The API version X does not match the Worker version Y"`).
- **Security**: `getDocument(...)` is called with `isEvalSupported: false` to mitigate
  CVE-2024-4367 (arbitrary JS execution from a crafted PDF via font handling), since the
  preview path renders untrusted, user-supplied PDFs.
- **Cleanup**: each preview run destroys its `loadingTask` / calls `pdf.cleanup()` in a
  `finally`, so superseded runs (rapid add/remove/reorder) don't keep rendering in the
  background.

### Image Processing
- All images (PNG, JPG, WebP) converted to compressed baseline JPEG before embedding
  (`embedJpg` only accepts baseline JPEG; the canvas round-trip guarantees that)
- Images scaled down to max 1600px dimension to reduce file size
- Transparent regions are flattened onto white (JPEG has no alpha)
- Images with no intrinsic dimensions (some SVGs) are rejected rather than producing a blank page
- WebP requires canvas conversion since pdf-lib doesn't support it natively

### Webpack Configuration
- `canvas` Node.js module aliased to `false` (pdfjs-dist only needs browser Canvas API)

### Security Model (privacy is enforced, not just intended)
- **Content-Security-Policy** ships two ways: as an HTTP header via `vercel.json` (strongest;
  also carries `frame-ancestors`) and as a `<meta>` tag in `layout.js` (so the policy holds
  even from `file://` or a non-Vercel static host).
- `connect-src 'self'` is the load-bearing directive — it blocks every outbound
  `fetch`/`XHR`/beacon, so user files physically cannot be uploaded or exfiltrated.
- `script-src` and `style-src` include `'unsafe-inline'`: **required** because Next.js static
  export inlines its hydration bootstrap as inline `<script>`, and styled-jsx / inline styles
  need inline CSS. Nonces/hashes aren't viable for a server-less static export. The script
  relaxation is an accepted tradeoff — `connect-src 'self'` still makes egress impossible.
  ⚠️ If you tighten `script-src` by removing `'unsafe-inline'`, hydration breaks and the app
  renders blank. Verify in a browser after any CSP change (see "Verifying" below).
- `worker-src 'self' blob:` and `'wasm-unsafe-eval'` cover the pdf.js worker.
- Other headers (in `vercel.json`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`,
  `Permissions-Policy` (camera/mic/geo/FLoC disabled).

### Error Isolation
- **Merge** processes each file in its own `try/catch`. A corrupt, encrypted, 0-byte, or
  otherwise unreadable file is skipped (not fatal); the merge completes with the remaining
  files and a toast lists what was skipped. If *nothing* merges, a clear error is shown.
- **Preview** similarly catches per-file and shows a "Could not render PDF" tile.

### A4 Page Fitting
- Pages/images are fitted to the **A4 bounding box** (`min(A4_W/w, A4_H/h)`), preserving
  aspect ratio — landscape pages stay landscape instead of being squashed to A4 width.
- PDF page `/Rotate` metadata is honored: 90°/270° pages swap their effective width/height
  when computing the fit scale, avoiding distortion (`page.getSize()` alone ignores rotation).
- The output page grows to at least A4 so single small images/pages still land on a full page.

## Key Features

### Layout States
- **Empty state**: Centered drop zone, no preview panel
- **With files**: Two-column layout — file list on left, combined preview on right

### File Management
- Drag-and-drop file upload
- Click to browse files
- Validation tolerates an empty/missing `file.type` by falling back to the file extension
  (browsers often report `type === ''` for dragged files, especially on Linux), so valid
  files aren't silently rejected. 0-byte files are skipped with a notice.
- Reorder via drag-and-drop or up/down arrow buttons
- Remove individual files or clear all (Clear all asks for confirmation)
- Soft warning when the selection is large (>50 files or >150 MB total) — no hard cap
- Shows file thumbnails, names, types, and sizes

### Preview
- Live combined preview showing all pages in merge order
- PDF pages rendered via pdfjs-dist at 1.2x scale
- Images displayed directly from object URLs
- Page numbers and source file labels

### PDF Output
- Pages fitted to the A4 bounding box (595.28 × 841.89pt), aspect ratio preserved, rotation
  honored (see "A4 Page Fitting" above)
- Content centered horizontally and pinned to the top of the page
- Images compressed to JPEG at 75% quality
- PDF object streams enabled for smaller file size
- **Download filename** derived from the first file via `buildDownloadName()`:
  `report.pdf` → `report-merged.pdf` (falls back to `merged-merged.pdf`)
- The blob URL is revoked on a deferred timeout (not immediately after `click()`), since an
  immediate revoke can abort the download in some browsers

### Accessibility
- Live regions announce status: the progress overlay (`role="status"`), a dedicated
  `.sr-only` live region for reorder/clear actions, and toasts (`role="status"` for info,
  `role="alert"` + `aria-live="assertive"` for errors)
- All icon-only buttons have `aria-label` (including the filename); decorative SVGs are
  `aria-hidden`
- The drop zone is **not** a `role="button"` (that would nest interactive controls); the real
  "browse" button is the single keyboard/AT entry point. Drag/drop is a mouse affordance.
- `<main>` landmark wraps the layout; the preview panel is a labeled `<section>` with a real
  `<h2>` heading
- `:focus-visible` outlines on all controls; `prefers-reduced-motion` neutralizes spinners,
  fades, and transforms; touch targets are ≥44px on coarse-pointer devices
- Color tokens meet WCAG AA contrast (`--text-secondary`/`--text-tertiary` were darkened)

## Code Patterns

### State Management
```javascript
const [files, setFiles] = useState([]);        // File entries with metadata
const [previews, setPreviews] = useState([]);   // Generated preview data
const [merging, setMerging] = useState(false);  // Merge in progress
const [progress, setProgress] = useState('');   // Progress message (in the overlay)
const [toast, setToast] = useState(null);       // { message, isError } | null
const [liveMessage, setLiveMessage] = useState(''); // sr-only live-region text
const filesRef = useRef(files);                 // mirror of files for unmount cleanup
```

### File Entry Structure
```javascript
{
  id: generateId(),     // crypto.randomUUID() with a getRandomValues fallback
  file: File,           // Original File object
  name: string,         // File name
  size: number,         // File size in bytes (always > 0; 0-byte files are rejected)
  type: string,         // MIME type, resolved from extension if the browser gave none
  thumbUrl: string|null // Object URL for image thumbnails
}
```

> **`generateId()`** is used instead of `crypto.randomUUID()` directly: the latter only exists
> in secure contexts (HTTPS/localhost) and would throw on `file://` or plain-`http` LAN — both
> valid for this offline-capable app. The fallback uses `crypto.getRandomValues`.

> **Object-URL lifecycle:** thumbnail URLs are revoked on remove, on clear-all, and on
> component unmount (via `filesRef`). `compressImage` revokes its URL on every exit path
> (success *and* error). The merge output blob URL is revoked on a deferred timeout.

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
- Responsive breakpoints at 860px and 520px; touch tweaks under `@media (pointer: coarse)`
- Transitions use `--transition: 180ms ease`
- Border radius uses `--radius`, `--radius-sm`, `--radius-xs`
- Accessibility utilities live at the end of `globals.css`: `.sr-only`, global
  `:focus-visible` outlines, and a `prefers-reduced-motion` block
- Text color tokens are tuned for WCAG AA contrast — keep them ≥4.5:1 if you change them

## Verifying

After changing the merge logic, the CSP, or the worker setup, verify in a real browser
(the CSP can silently break hydration or the pdf.js worker — neither shows up in the build):

```bash
npm run build
cd out && python3 -m http.server 4555   # serve the static export
```

Then load `http://localhost:4555`, add a PDF + an image, confirm previews render and the
merge downloads. Watch the console for **CSP violations** (e.g. "Refused to…") — zero is the
expected result. A blank page with an empty `<title>` means the CSP blocked Next's inline
bootstrap (`script-src` needs `'unsafe-inline'`).

## Important Constraints

- No server-side code — everything runs in browser
- No external UI libraries — keep bundle small
- No file uploads — privacy is a core feature, **enforced** by `connect-src 'self'` in the CSP
- Support PDF, PNG, JPG, JPEG, WebP only
- Must work offline after initial page load (so no secure-context-only APIs without a fallback)
- Merge must be resilient: one bad file never discards the whole batch
- Keep `public/pdf.worker.min.js` in sync with `pdfjs-dist` (handled by the copy script)
