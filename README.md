# PDF Merger

A privacy-focused web app for merging PDFs and images into a single PDF document. All processing happens locally in your browser — your files never leave your device.

## Why?

I can't trust some files on online tools, so I built a simple local solution

<img width="1460" height="1188" alt="Screenshot 2026-02-13 at 13 38 00" src="https://github.com/user-attachments/assets/5eb57cb6-e5b4-4524-810e-6713df24af14" />


## Features

- Upload PDF, PNG, JPG, JPEG, and WebP files
- Drag-and-drop file upload (with extension fallback when the browser reports no MIME type)
- Rearrange, rotate, crop or delete **individual pages** — not just whole files
- Reorder by dragging a page, or move a whole document as a block
- Live page-by-page preview, rendered lazily so large documents stay responsive
- Bookmarks in the output, one per source document
- Choose image quality (including lossless), page size (A4 / US Letter / keep original), and the output file name
- Dark mode, following your system setting
- Cancel a long merge
- Merge into a single PDF, fitted to the A4 page box (landscape and rotated pages handled,
  small pages never blown up)
- Hyperlinks stay clickable in the right place; form fields are flattened so they can't be
  silently lost
- Resilient merge: a corrupt, password-protected, or unreadable file is skipped with a named
  reason, not fatal — the rest still merge
- Output filename derived from the first file (e.g. `report.pdf` → `report-merged.pdf`)
- Compressed output for smaller file sizes
- Accessible: screen-reader announcements, keyboard reordering, visible focus, reduced-motion support
- **Genuinely works offline** — a service worker precaches the whole app on your first visit,
  so it keeps working with no connection. Installable as a PWA.

## Install it

Open [merge-pdf.nicanor.xyz](https://merge-pdf.nicanor.xyz) and use your browser's "Install"
or "Add to Home Screen" option. After that it launches like any other app and works with no
connection at all.

## Privacy & Security

This app is **100% client-side** — no files are ever uploaded to a server. Beyond simply
not having upload code, the privacy guarantee is *enforced* by a strict Content-Security-Policy:

- `connect-src 'self'` blocks every outbound `fetch`/`XHR`/beacon, so files physically cannot
  leave your device — even if a future bug or a malicious PDF tried.
- The CSP ships both as an HTTP header (via `vercel.json`, when hosted on Vercel) and as a
  `<meta>` tag (so the guarantee holds even from `file://` or any plain static host).
- PDFs are rendered with pdf.js configured `isEvalSupported: false`, mitigating CVE-2024-4367
  (arbitrary JS execution from a crafted PDF).
- Additional hardening headers: `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, and a restrictive `Permissions-Policy`.

The service worker only ever caches the app's own files; your documents never traverse the
network, so it never sees them.

See [CLAUDE.md](./CLAUDE.md) for the full security model and [SECURITY.md](./SECURITY.md) for
how to report an issue.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Tests**: Vitest
- **Framework**: Next.js 15 (App Router, static export)
- **Language**: JavaScript (React 19)
- **PDF Creation**: pdf-lib
- **PDF Preview**: pdfjs-dist
- **Styling**: Plain CSS

## Getting Started

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production (outputs to out/)
bun run build

# Preview production build
bun run start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tests

```bash
bun run test
```

Because the CSP blocks all outbound requests, this app has no error reporting — so the test
suite is the only safety net. 95 assertions: it builds real PDFs (linked, form-bearing,
rotated, landscape, encrypted, page-less, corrupt), asserts on the merged output, and covers
the page model, the rotation/crop coordinate maths, and the output settings. CI runs the tests, the static build,
and a check that the committed pdf.js worker matches the installed `pdfjs-dist`.

> **Note:** `bun install` and `bun run build` automatically copy the pdf.js worker into
> `public/pdf.worker.min.js` (via `scripts/copy-pdf-worker.mjs`), keeping it in lock-step with
> the installed `pdfjs-dist` version. If you ever change the pdfjs-dist version, the worker is
> re-copied on the next install/build — no manual step needed.

## Limits

There is no hard cap on file size or count, but everything is processed in memory in the
browser. Selecting a very large batch (more than ~50 files or ~150 MB total) shows a warning,
since the merge can be slow or memory-heavy. Empty (0-byte) and unsupported files are skipped
with a notice.

## License

MIT
