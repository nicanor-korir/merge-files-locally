# PROMPT.md

## Original Prompt

> Build me a simple web solution to upload images, PDFs files then merge into one document. Also an option to drag and drop to select the order it should appear locally then option to download as one PDF. The UI/UX should be very simple with modern light theme.

## Evolution of Requirements

### Initial Build
- Basic file upload (PDF, PNG, JPG, JPEG, WebP)
- Drag-and-drop upload
- Reorder files before merging
- Merge into single PDF
- Download merged PDF
- Modern light theme UI

### Migration Request
> Use Next.js with Next runtime instead of Vite

- Migrated from Vite to Next.js 15
- Configured for static export (`output: 'export'`)
- Improved overall UI/UX

### Two-Column Layout Request
> Upload goes to the left and preview of all files goes to the right — show like a combined PDF before merge

- Split into two-column layout
- Left panel: upload zone + file list
- Right panel: live combined preview
- Preview shows all pages in merge order

### Header Merge Button Request
> Put merge and download button on the left of 'Private'

- Added "Merge & Download" button to header
- Button appears only when files are uploaded
- Keeps action accessible without scrolling

### Centered Empty State Request
> If user hasn't uploaded anything then center the upload drag and drop and remove the 'Preview will appear here' section

- Centered drop zone when no files uploaded
- Preview panel hidden until files added
- Two-column layout appears after first upload

### A4 Page Normalization Request
> Some images/PDF pages will be of different sizes, format all pages to be of the same page width and normal A4 PDF pages

- All pages normalized to A4 width (595.28pt)
- Aspect ratio preserved
- Content positioned at top of page

### File Size Compression Request
> The file being downloaded becomes large, is there a way to compress into smaller bytes

- Images compressed to JPEG at 75% quality
- Large images scaled down to max 1600px
- PDF object streams enabled for compression

## Current Requirements

### Functional Requirements

| Feature | Status | Notes |
|---------|--------|-------|
| Upload PDF files | ✅ | Via drag-drop or file picker |
| Upload PNG/JPG/JPEG images | ✅ | Via drag-drop or file picker |
| Upload WebP images | ✅ | Converted to JPEG internally |
| Drag-and-drop upload | ✅ | Visual feedback on drag over |
| Reorder files via drag | ✅ | Drag handle on each item |
| Reorder via arrow buttons | ✅ | Up/down buttons per item |
| Live combined preview | ✅ | Shows all pages in order |
| Merge all files to PDF | ✅ | Single click action |
| Download merged PDF | ✅ | Auto-downloads as merged.pdf |
| Remove individual files | ✅ | X button on each item |
| Clear all files | ✅ | Clear all button |
| A4 page normalization | ✅ | Consistent output formatting |
| PDF compression | ✅ | Smaller output file size |

### Non-Functional Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| 100% client-side processing | ✅ | No server uploads |
| Privacy-focused | ✅ | Files never leave device |
| Modern light theme | ✅ | Clean, minimal design |
| Responsive design | ✅ | Works on desktop and mobile |
| Fast preview generation | ✅ | Async with loading states |
| No account required | ✅ | Works immediately |
| Works offline | ✅ | After initial page load |
| Small bundle size | ✅ | No UI framework dependencies |

### UI/UX Requirements

| Element | Status | Notes |
|---------|--------|-------|
| Centered empty state | ✅ | Drop zone centered, no preview |
| Two-column with files | ✅ | List left, preview right |
| Header merge button | ✅ | Always accessible |
| Progress indicator | ✅ | Overlay during merge |
| Toast notifications | ✅ | Success/error feedback |
| File thumbnails | ✅ | Images show preview |
| Page count display | ✅ | Shows total pages |
| Drag visual feedback | ✅ | Highlight on drag over |

## Supported File Types

| Type | MIME | Extension | Notes |
|------|------|-----------|-------|
| PDF | application/pdf | .pdf | Multi-page supported |
| PNG | image/png | .png | Converted to JPEG |
| JPEG | image/jpeg | .jpg, .jpeg | Native support |
| WebP | image/webp | .webp | Converted to JPEG |

## Output Specifications

- **Format**: PDF
- **Page Width**: 595.28pt (A4)
- **Page Height**: Variable (min A4 841.89pt)
- **Image Quality**: 75% JPEG
- **Image Max Dimension**: 1600px
- **Compression**: Object streams enabled

## Future Considerations

Potential enhancements (not currently implemented):

- [ ] Custom output filename
- [ ] Page size options (Letter, Legal, etc.)
- [ ] Image quality slider
- [ ] Page rotation
- [ ] Page deletion from preview
- [ ] Drag reorder in preview panel
- [ ] Dark mode theme
- [ ] PWA support for offline install
- [ ] Batch processing multiple outputs
