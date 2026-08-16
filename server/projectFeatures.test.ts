import { describe, expect, it } from 'vitest';
import { clampProjectProgress, isAllowedProjectDocumentType } from '../shared/projectFeatures';

describe('project document validation', () => {
  it('allows construction images, PDFs, and text notes', () => {
    expect(isAllowedProjectDocumentType('image/jpeg')).toBe(true);
    expect(isAllowedProjectDocumentType('application/pdf')).toBe(true);
    expect(isAllowedProjectDocumentType('text/plain')).toBe(true);
  });

  it('rejects executable and unsupported binary types', () => {
    expect(isAllowedProjectDocumentType('application/javascript')).toBe(false);
    expect(isAllowedProjectDocumentType('application/zip')).toBe(false);
    expect(isAllowedProjectDocumentType('')).toBe(false);
  });
});

describe('project progress normalization', () => {
  it('clamps progress to the 0–100 range and rounds decimals', () => {
    expect(clampProjectProgress(-10)).toBe(0);
    expect(clampProjectProgress(42.6)).toBe(43);
    expect(clampProjectProgress(125)).toBe(100);
  });
});
