# PDF Merger

A privacy-focused web app for merging PDFs and images into a single PDF document. All processing happens locally in your browser — your files never leave your device.

## Why?

I can't trust some files on online tools, so I built a simple local solution

<img width="1460" height="1188" alt="Screenshot 2026-02-13 at 13 38 00" src="https://github.com/user-attachments/assets/5eb57cb6-e5b4-4524-810e-6713df24af14" />


## Features

- Upload PDF, PNG, JPG, JPEG, and WebP files
- Drag-and-drop file upload
- Reorder files via drag-and-drop or arrow buttons
- Live combined preview before merging
- Merge into a single PDF with A4 page formatting
- Compressed output for smaller file sizes
- Works offline after initial page load

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
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

## Privacy

This app is 100% client-side. No files are uploaded to any server. All PDF processing happens entirely in your browser using JavaScript.

## License

MIT
