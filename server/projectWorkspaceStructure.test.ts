import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * ONE PLACE TO UPLOAD A PROJECT DOCUMENT.
 *
 * BuildHub had two, and then briefly three.
 *
 * `ProjectDetailEnhancements` (the Operations tab) carried working Files and
 * Invoices panels. The top-level Documents tab was a hardcoded placeholder
 * with a dead button. Building that tab properly produced a THIRD upload
 * implementation before anybody noticed the second, because both existing
 * halves worked - nothing errored, and a search for "broken" found neither.
 *
 * The test that used to live here asserted where a hidden file input sat
 * relative to the tab panels. It passed throughout, because it was about the
 * arrangement of one implementation rather than about how many there were.
 * That is the lesson worth keeping: a structural assertion inside a component
 * cannot see a duplicate of that component.
 *
 * `ProjectDocuments` is the single surface now. Invoices are not lost - they
 * are a document `type`, reachable through its filter, which is exactly what
 * they always were in the schema.
 */

const UPLOAD_MUTATION = 'trpc.projects.uploadDocument.useMutation';

function clientSources(): { path: string; source: string }[] {
  const paths = globSync('client/src/**/*.tsx');
  expect(paths.length, 'no client sources found - this test would be vacuous').toBeGreaterThan(20);
  return paths.map(path => ({ path, source: readFileSync(path, 'utf8') }));
}

describe('project document uploads have exactly one implementation', () => {
  it('only one component calls the upload mutation', () => {
    const callers = clientSources()
      .filter(file => file.source.includes(UPLOAD_MUTATION))
      .map(file => file.path);
    expect(callers, `expected exactly one uploader, found: ${callers.join(', ')}`).toHaveLength(1);
    expect(callers[0]).toContain('ProjectDocuments.tsx');
  });

  it('the operations workspace no longer carries its own file panels', () => {
    const source = readFileSync('client/src/components/ProjectDetailEnhancements.tsx', 'utf8');
    expect(source).not.toContain('<TabsContent value="files">');
    expect(source).not.toContain('<TabsContent value="invoices">');
    expect(source).not.toContain('fileInputRef');
  });

  it('it still owns what was never duplicated - timeline and progress reports', () => {
    // Removing the duplication must not have removed the component's actual job.
    const source = readFileSync('client/src/components/ProjectDetailEnhancements.tsx', 'utf8');
    expect(source).toContain('<TabsContent value="timeline">');
    expect(source).toContain('<TabsContent value="reports">');
    expect(source).toContain('trpc.projects.addProgressReport.useMutation');
  });

  it('invoices remain reachable, as a document type rather than a second panel', () => {
    const docs = readFileSync('client/src/components/ProjectDocuments.tsx', 'utf8');
    const shared = readFileSync('shared/projectFeatures.ts', 'utf8');
    expect(shared).toContain("'invoice'");
    // The filter is built from the shared type list, so every type - invoice
    // included - is selectable without naming any of them here.
    expect(docs).toContain('PROJECT_DOCUMENT_TYPES.map');
    expect(docs).toContain('data-testid="documents-filter"');
  });

  it('only one component reads the document list, for the same reason', () => {
    const readers = clientSources()
      .filter(file => file.source.includes('trpc.projects.documents.useQuery'))
      .map(file => file.path);
    expect(readers, `expected one reader, found: ${readers.join(', ')}`).toHaveLength(1);
  });
});
