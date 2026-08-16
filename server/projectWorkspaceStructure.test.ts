import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('project workspace upload structure', () => {
  it('mounts the shared invoice/file input before the tab panels', () => {
    const source = readFileSync(resolve(process.cwd(), 'client/src/components/ProjectDetailEnhancements.tsx'), 'utf8');
    const inputIndex = source.indexOf('ref={fileInputRef}');
    const tabsIndex = source.indexOf('<TabsList');
    const invoicePanelIndex = source.indexOf('<TabsContent value="invoices">');
    expect(inputIndex).toBeGreaterThan(-1);
    expect(inputIndex).toBeLessThan(tabsIndex);
    expect(inputIndex).toBeLessThan(invoicePanelIndex);
  });
});
