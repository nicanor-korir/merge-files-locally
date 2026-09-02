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
  pdf-merger.js    — Main client component: UI, state, lazy page rendering (no merge logic)
lib/
  merge.js         — mergeDocuments(): the whole merge pipeline, DOM-free and unit-tested
  pages.js         — The page model: reconcile, reorder, rotate, crop, remove (all pure)
  pdf-geometry.js  — A4 fitting, annotation transforms, rotation/crop → content-space maths
  file-types.js    — Validation, MIME resolution, download naming, id generation
  compress-image.js— Browser-only canvas → baseline JPEG, applying rotation + crop
  *.test.js        — Vitest suites (run in Node)
  __fixtures__/    — Programmatic PDF builders + a 1x1 baseline JPEG
.github/workflows/
  ci.yml           — Tests, build, and a pdf.js worker drift check on every push/PR
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
bun run test           # Run the Vitest suite once
bun run test:watch     # Re-run tests on change
```

## Architecture Notes

### Static Export
- Uses `output: 'export'` in Next.js config for fully static site generation
- No Node.js server required in production — can be hosted on any static file server
- Build outputs to `out/` directory

### The Page Model
State is **`pages[]`, not `files[]`**. A page entry is one page of the *output*:

```javascript
{ id, fileId, sourceIndex, rotation, crop }
```

It holds no pixels and no bytes — only a pointer back to a source document plus the transforms
the user applied. Everything else follows from that:

- **Reordering, rotating, cropping and deleting are all O(1) state edits.** None of them
  invalidate a rendered preview, because `renderKey(page)` is `fileId:sourceIndex` and
  deliberately excludes rotation and crop (both are re-applied over the cached bitmap).
- Pages from different documents can interleave freely; the output is exactly the page order.
- `files[]` still exists, but only as the list of *sources* — what the user added, not what
  the output looks like.

`reconcilePages()` keeps the two in step: pages of a removed file drop out, a new file appends
its pages, and everything else keeps its position and transforms. `seenFileIds` is what stops
a document the user has emptied page by page from silently refilling itself.

Whole documents can still be moved as a block (`moveFileBlock`), but only while
`arePagesGroupedByFile()` holds — once the user has interleaved pages by hand there is no
block left to move, and the arrows disable rather than silently regrouping their work.

### Preview Rendering
- Pages render **lazily**, on `IntersectionObserver` intersection with a 600px margin, so a
  400-page document does not rasterise 400 pages before the user scrolls.
- Rendered pages are cached as **`ImageBitmap`s keyed by `renderKey`**, not base64 data URLs
  in React state. The cache is capped at `MAX_CACHED_RASTERS`; evicted entries are *dropped*
  rather than `close()`d, because a component may still hold one and drawing a closed bitmap
  throws.
- Each source PDF is opened **once** with pdf.js and kept open while it is in the list
  (`docsRef`), so rendering page 40 does not re-read the file. The document is destroyed when
  the file is removed or the component unmounts.
- `drawPage()` applies rotation and crop over the cached bitmap **in the same order as
  `compressImage()`** — rotate, then crop the rotated result. The preview is what the user
  cropped against, so any divergence would surface as output that does not match what they saw.

### Client-Side Processing
- `pdf-merger.js` is marked with `'use client'` directive
- All file handling, preview generation, and PDF merging runs in the browser
- Uses Web APIs: File API, Canvas API, Blob, URL.createObjectURL

### Why the merge logic lives in `lib/`
The CSP forbids all egress (`connect-src 'self'`), so this app has **no error reporting and
never will** — tests are not one safety net among several, they are the only one. `lib/merge.js`
is therefore kept free of DOM APIs: `compressImage` is passed in as a parameter rather than
imported, so the entire merge pipeline runs under Vitest in Node against real PDF fixtures.
Anything that can only run in a browser (canvas, object URLs, pdf.js rendering) stays in
`app/pdf-merger.js` or `lib/compress-image.js`.

Every defect the test suite covers was a real bug that shipped silently. Add a fixture before
fixing a merge bug, not after.

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
- **Merge** is cancellable: pass an `AbortSignal`, and it checks between pages and throws
  `MergeCancelled`. It also yields to the event loop every few pages so the progress overlay
  actually repaints and the cancel click is seen — the merge still runs on the main thread.
- **Merge** processes each source in its own `try/catch`. A corrupt, encrypted, 0-byte, page-less
  or otherwise unreadable file is skipped (not fatal); the merge completes with the remaining
  files and a toast names each skipped file *with its reason*
  (`password-protected` / `no pages` / `unreadable`). If *nothing* merges, a clear error is shown.
- **Preview** similarly catches per-file and shows a "Could not render PDF" tile.

### A4 Page Fitting
- Pages are fitted to the **A4 bounding box** (`min(A4_W/w, A4_H/h, 1)`), preserving aspect
  ratio — landscape pages stay landscape instead of being squashed to A4 width.
- **The scale is capped at 1**: a PDF page carries a real physical size, so enlarging a small
  one (a receipt, a half-letter slip) only produces a soft, blown-up scan. Small pages keep
  their size and sit centred at the top of a full A4 sheet.
- Images are the exception — they are scaled *up* to fill the sheet, because an image has no
  intrinsic physical size (its pixels are not points) so there is nothing to preserve.
- PDF page `/Rotate` metadata is honored for all four angles. A 90°/270° page swaps its
  effective width/height when computing the fit scale, and its media box is sized to A4
  *height × width* so the displayed page is A4 once the rotation is applied.
- Where the visual top edge lives in content space depends on the rotation (0 → +y, 90 → −x,
  270 → +x, 180 → −y); `contentOffset()` in `pdf-geometry.js` encodes this.

### Rotation and Crop
- A page's `rotation` is **added to** whatever `/Rotate` the source already carried, because
  the user rotated what they saw — and what they saw was already rendered rotated by pdf.js.
- `crop` is a normalized `{x, y, width, height}` in **display space**: origin top-left, y down,
  0..1 fractions — the way a box is dragged over the preview. Content space is the opposite on
  both counts (origin bottom-left, y up) *and* the display rotation swaps the axes on top of
  that, so `cropToContentRect()` maps between them per rotation. The mappings come from where
  each content corner lands once `/Rotate` is applied; a full-page crop must map back to the
  whole media box for all four rotations, which is the property the tests pin.
- `applyPageTransform()` normalizes the page's visible box to the origin first. The **crop box
  is the reference, not the media box**: it is what a viewer displays, so it is what the user
  cropped against.
- Images take a different path entirely — rotation and crop are applied in `compressImage()`
  via two canvas passes, because an image has no page boxes to rewrite.

### Annotations, Forms and Metadata
- `scaleContent()`/`translateContent()` transform **only the content stream**. pdf-lib ships
  `scaleAnnotations()` but no translate counterpart, so `translateAnnotations()` in
  `pdf-geometry.js` shifts each annotation's absolute coordinate arrays (`Rect`, `QuadPoints`,
  `Vertices`, `L`, `CL`, `InkList`). Without both halves, links and widgets stay at their
  authored coordinates while the visible content moves — a silent, invisible corruption.
  `/RD` is deliberately excluded: it holds *relative* insets, so it scales but must not shift.
- **Form fields are flattened** before copying. Widget annotations survive `copyPages` but the
  document-level `/AcroForm` does not, which would leave fields visible, misplaced and dead.
  Flattening bakes each field's appearance into the page content. pdf-lib's `flatten()` leaves
  the now-dangling widget entries in `/Annots`, so `removeFlattenedWidgets()` strips them.
- **Encrypted PDFs are refused explicitly.** `ignoreEncryption: true` lets pdf-lib *open* an
  encrypted file without decrypting it, so its pages copy as unreadable garbage rather than
  throwing — it would sail past the per-file `try/catch`. The merge checks `isEncrypted` and
  skips the file with a `password-protected` reason instead.
- **Output metadata is deliberate and minimal.** The document is created with
  `updateMetadata: false` so pdf-lib does not stamp its own Producer or a wall-clock
  timestamp; Producer/Creator/Title are then set explicitly. Note that `PDFDocument.load()`
  *also* defaults to `updateMetadata: true` and will overwrite Producer on read — pass
  `{ updateMetadata: false }` when asserting on it in tests.

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
- Pages fitted to the A4 bounding box (595.28 × 841.89pt), aspect ratio preserved, never
  upscaled, rotation honored (see "A4 Page Fitting" above)
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

```bash
bun run test    # 76 assertions over the merge pipeline and page model — run this first
```

The suite builds real PDFs (linked, form-bearing, rotated, landscape, encrypted, page-less,
corrupt) and asserts on the merged output, so most merge regressions are caught here. The page
model and the crop/rotation maths are pure functions and fully covered.

After changing the merge logic, the CSP, or the worker setup, **also** verify in a real browser
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
