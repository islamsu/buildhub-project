import { describe, it, expect } from 'vitest';
import { acceptQuotationSecure } from './quotationWorkflow';

describe('Quotation Workflow State Machine & Security', () => {
  it('rejects unauthenticated or unauthorized quotation acceptance', async () => {
    await expect(acceptQuotationSecure(9999, 9999, 1)).rejects.toThrow();
  });
});
