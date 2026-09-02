import { describe, expect, it } from 'vitest';
import {
  buildDownloadName,
  fileExtension,
  formatSize,
  generateId,
  isAcceptedFile,
  resolveType,
} from './file-types.js';

const file = (name, type = '') => ({ name, type });

describe('isAcceptedFile', () => {
  it('accepts supported MIME types', () => {
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']) {
      expect(isAcceptedFile(file('x', type))).toBe(true);
    }
  });

  it('falls back to the extension when the browser reports no type', () => {
    // Dragged files, especially on Linux, often arrive with type === ''.
    expect(isAcceptedFile(file('report.pdf'))).toBe(true);
    expect(isAcceptedFile(file('scan.JPEG'))).toBe(true);
  });

  it('rejects unsupported formats', () => {
    expect(isAcceptedFile(file('notes.txt', 'text/plain'))).toBe(false);
    expect(isAcceptedFile(file('archive.zip'))).toBe(false);
    expect(isAcceptedFile(file('no-extension'))).toBe(false);
  });
});

describe('resolveType', () => {
  it('keeps a type the browser supplied', () => {
    expect(resolveType(file('x.png', 'image/png'))).toBe('image/png');
  });

  it('derives a type from the extension otherwise', () => {
    expect(resolveType(file('a.pdf'))).toBe('application/pdf');
    expect(resolveType(file('a.JPG'))).toBe('image/jpeg');
    expect(resolveType(file('a.jpeg'))).toBe('image/jpeg');
    expect(resolveType(file('a.webp'))).toBe('image/webp');
    expect(resolveType(file('a.bin'))).toBe('');
  });
});

describe('buildDownloadName', () => {
  it('names the output after the first file', () => {
    expect(buildDownloadName('report.pdf')).toBe('report-merged.pdf');
    expect(buildDownloadName('holiday photo.jpeg')).toBe('holiday photo-merged.pdf');
  });

  it('only strips the final extension', () => {
    expect(buildDownloadName('2026.q1.report.pdf')).toBe('2026.q1.report-merged.pdf');
  });

  it('falls back when there is no usable name', () => {
    expect(buildDownloadName('')).toBe('merged-merged.pdf');
    expect(buildDownloadName(undefined)).toBe('merged-merged.pdf');
    expect(buildDownloadName('.pdf')).toBe('merged-merged.pdf');
  });
});

describe('fileExtension', () => {
  it('lowercases and handles missing extensions', () => {
    expect(fileExtension('A.PDF')).toBe('pdf');
    expect(fileExtension('plain')).toBe('');
    expect(fileExtension('.hidden')).toBe('hidden');
  });
});

describe('formatSize', () => {
  it('switches units at the right boundaries', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });
});

describe('generateId', () => {
  it('returns distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, generateId));
    expect(ids.size).toBe(500);
  });
});
