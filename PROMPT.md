# PROMPT.md

## Original Prompt

> Build me a simple web solution to upload images, PDFs files then merge into one document. Also an option to drag and drop to select the order it should appear locally then option to download as one PDF. The UI/UX should be very simple with modern light theme.

## Follow-up Requests

1. **Migrate to Next.js**: Use Next.js 16 with Next runtime instead of Vite
2. **Improve UI/UX**: Ensure it's working with better design
3. **Two-column layout with preview**: Upload goes to the left and preview of all files goes to the right — show like a combined PDF before merge

## Requirements

### Functional
- Upload PDF, PNG, JPG, JPEG, WebP files
- Drag-and-drop file upload
- Reorder files via drag-and-drop or arrow buttons
- Live combined preview showing all pages in merge order
- Merge all files into a single PDF
- Download the merged PDF
- Remove individual files or clear all

### Non-Functional
- 100% client-side — no files leave the device
- Modern light theme with clean, minimal design
- Responsive — works on desktop and mobile
- Fast preview generation
- No account or server required
