import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_QUALITY,
  PAGE_SIZES,
  pageSizeOf,
  QUALITY_PRESETS,
  qualityOf,
  sanitizeDownloadName,
} from './output-settings.js';

describe('pageSizeOf', () => {
  it('resolves each known size', () => {
    expect(pageSizeOf('a4').width).toBeCloseTo(595.28, 2);
    expect(pageSizeOf('letter').width).toBe(612);
    expect(pageSizeOf('letter').height).toBe(792);
  });

  it('gives "keep original" no target box, which is how the merge skips fitting', () => {
    expect(pageSizeOf('original').width).toBeNull();
  });

  it('falls back to the default rather than returning undefined', () => {
    expect(pageSizeOf('foolscap')).toBe(PAGE_SIZES[DEFAULT_PAGE_SIZE]);
    expect(pageSizeOf(undefined)).toBe(PAGE_SIZES[DEFAULT_PAGE_SIZE]);
  });
});

describe('qualityOf', () => {
  it('only marks the original preset lossless', () => {
    expect(qualityOf('original').lossless).toBe(true);
    expect(qualityOf('balanced').lossless).toBe(false);
    expect(qualityOf('small').lossless).toBe(false);
  });

  it('does not cap the original preset', () => {
    expect(qualityOf('original').maxDimension).toBe(Infinity);
  });

  it('orders the presets from largest to smallest output', () => {
    expect(qualityOf('balanced').maxDimension).toBeGreaterThan(qualityOf('small').maxDimension);
    expect(qualityOf('balanced').jpegQuality).toBeGreaterThan(qualityOf('small').jpegQuality);
  });

  it('falls back to the default', () => {
    expect(qualityOf('lossy-as-you-like')).toBe(QUALITY_PRESETS[DEFAULT_QUALITY]);
  });
});

describe('sanitizeDownloadName', () => {
  it('adds the extension exactly once', () => {
    expect(sanitizeDownloadName('report')).toBe('report.pdf');
    expect(sanitizeDownloadName('report.pdf')).toBe('report.pdf');
    expect(sanitizeDownloadName('report.PDF')).toBe('report.pdf');
  });

  it('keeps dots that are part of the name', () => {
    expect(sanitizeDownloadName('2026.q1.report')).toBe('2026.q1.report.pdf');
  });

  it('strips path separators so the name cannot escape the download folder', () => {
    expect(sanitizeDownloadName('../../etc/passwd')).toBe('....etcpasswd.pdf');
    expect(sanitizeDownloadName('a/b\\c')).toBe('abc.pdf');
  });

  it('strips characters Windows rejects in a filename', () => {
    expect(sanitizeDownloadName('in:va*lid?"<>|')).toBe('invalid.pdf');
  });

  it('strips control characters', () => {
    expect(sanitizeDownloadName('re\x07po\x1frt')).toBe('report.pdf');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeDownloadName('')).toBe('merged.pdf');
    expect(sanitizeDownloadName('   ')).toBe('merged.pdf');
    expect(sanitizeDownloadName('.pdf')).toBe('merged.pdf');
    expect(sanitizeDownloadName('///')).toBe('merged.pdf');
    expect(sanitizeDownloadName(null, 'report-merged.pdf')).toBe('report-merged.pdf');
  });
});
