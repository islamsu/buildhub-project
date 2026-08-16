import { describe, expect, it } from 'vitest';
import {
  isAllowedRfqAttachmentType,
  isValidRfqAttachmentSize,
  MAX_RFQ_ATTACHMENT_SIZE,
  MAX_RFQ_ATTACHMENTS,
} from './rfqAttachments';
import { parseRfqAttachments } from '../shared/rfqAttachments';

describe('RFQ attachment validation', () => {
  it('allows images and PDF floor plans', () => {
    expect(isAllowedRfqAttachmentType('image/jpeg')).toBe(true);
    expect(isAllowedRfqAttachmentType('image/png')).toBe(true);
    expect(isAllowedRfqAttachmentType('application/pdf')).toBe(true);
  });

  it('rejects executable, archive, and empty content types', () => {
    expect(isAllowedRfqAttachmentType('application/zip')).toBe(false);
    expect(isAllowedRfqAttachmentType('application/javascript')).toBe(false);
    expect(isAllowedRfqAttachmentType('')).toBe(false);
  });

  it('accepts positive files up to the 8MB boundary and rejects oversized or invalid sizes', () => {
    expect(isValidRfqAttachmentSize(1)).toBe(true);
    expect(isValidRfqAttachmentSize(MAX_RFQ_ATTACHMENT_SIZE)).toBe(true);
    expect(isValidRfqAttachmentSize(MAX_RFQ_ATTACHMENT_SIZE + 1)).toBe(false);
    expect(isValidRfqAttachmentSize(0)).toBe(false);
    expect(isValidRfqAttachmentSize(-1)).toBe(false);
    expect(isValidRfqAttachmentSize(Number.NaN)).toBe(false);
  });

  it('parses valid stored metadata and filters malformed entries', () => {
    const raw = JSON.stringify([
      { key: 'a', url: '/manus-storage/a', name: 'plan.pdf', type: 'application/pdf', size: 42 },
      { key: 'broken', url: '/manus-storage/broken' },
    ]);
    expect(parseRfqAttachments(raw)).toEqual([
      { key: 'a', url: '/manus-storage/a', name: 'plan.pdf', type: 'application/pdf', size: 42 },
    ]);
  });

  it('returns an empty list for empty or malformed stored metadata', () => {
    expect(parseRfqAttachments(null)).toEqual([]);
    expect(parseRfqAttachments('')).toEqual([]);
    expect(parseRfqAttachments('{not-json')).toEqual([]);
    expect(parseRfqAttachments(JSON.stringify({ key: 'not-an-array' }))).toEqual([]);
  });

  it('keeps the RFQ form attachment count within the product limit', () => {
    expect(MAX_RFQ_ATTACHMENTS).toBe(6);
  });
});
