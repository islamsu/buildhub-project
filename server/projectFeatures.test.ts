import { describe, expect, it } from 'vitest';
import {
  clampProjectProgress, isAllowedProjectDocumentType, PROJECT_DOCUMENT_CONTENT_TYPES,
} from '../shared/projectFeatures';
import { DOCUMENT_TYPES } from './_core/fileType';

describe('project document validation', () => {
  it('allows construction images and PDFs', () => {
    expect(isAllowedProjectDocumentType('image/jpeg')).toBe(true);
    expect(isAllowedProjectDocumentType('application/pdf')).toBe(true);
  });

  it('rejects executable and unsupported binary types', () => {
    expect(isAllowedProjectDocumentType('application/javascript')).toBe(false);
    expect(isAllowedProjectDocumentType('application/zip')).toBe(false);
    expect(isAllowedProjectDocumentType('')).toBe(false);
  });

  /**
   * CONTRACT CHANGED DELIBERATELY. This used to assert `text/plain` was
   * allowed, and it was - by this function. The byte sniffer that runs
   * immediately afterwards in `uploadDocument` then rejected it, because
   * DOCUMENT_TYPES only covers formats with a magic number to verify.
   *
   * So the product advertised text uploads it could never accept, and said so
   * only after the user had chosen a file. Two allowlists disagreeing is worse
   * than either one alone: the narrow one decides, and the wide one just
   * decides WHEN the user finds out.
   */
  it('accepts exactly what the byte sniffer can verify - no wider', () => {
    expect([...PROJECT_DOCUMENT_CONTENT_TYPES].sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it('every declared type really does pass the declared check', () => {
    // Guards against the list and the predicate drifting apart, which would
    // reintroduce the same class of gap one level down.
    for (const type of PROJECT_DOCUMENT_CONTENT_TYPES) {
      expect(isAllowedProjectDocumentType(type), type).toBe(true);
    }
  });

  it('no longer accepts a type nothing downstream can check', () => {
    for (const type of ['text/plain', 'text/csv', 'image/svg+xml', 'image/bmp']) {
      expect(isAllowedProjectDocumentType(type), type).toBe(false);
    }
  });
});

describe('project progress normalization', () => {
  it('clamps progress to the 0–100 range and rounds decimals', () => {
    expect(clampProjectProgress(-10)).toBe(0);
    expect(clampProjectProgress(42.6)).toBe(43);
    expect(clampProjectProgress(125)).toBe(100);
  });
});
