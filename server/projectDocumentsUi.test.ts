import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROJECT_DOCUMENT_CONTENT_TYPES } from '@shared/projectFeatures';

/**
 * THE DOCUMENTS TAB.
 *
 * `projects.documents` and `projects.uploadDocument` were both complete:
 * owner-scoped, rate-limited, size-capped, byte-sniffed. The tab that was
 * meant to reach them was a hardcoded panel - an icon, the sentence "Upload
 * drawings, BOQs, contracts, and invoices", and an Upload button with no
 * handler.
 *
 * That combination is worth naming, because it is the hardest kind of gap to
 * see: a screen that DESCRIBES a feature is the most convincing possible
 * evidence the feature works. Nothing is broken, nothing errors, and the
 * capability is simply unreachable.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const strip = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const PAGE = strip(read('../client/src/pages/ProjectDetail.tsx'));
const DOCS = strip(read('../client/src/components/ProjectDocuments.tsx'));
const ROUTERS = strip(read('./routers.ts'));

describe('the tab is wired to the procedures that already existed', () => {
  it('the placeholder panel is gone', () => {
    // The exact string that made the gap invisible.
    expect(PAGE).not.toContain('Document Management');
  });

  it('there is no longer an Upload button with no handler', () => {
    // The defect in one assertion: a control that looked like a feature.
    expect(PAGE).not.toMatch(/<Button className="mt-4 gap-2" variant="outline">\s*<Plus[^>]*\/>\s*Upload Document/);
  });

  it('the tab renders the real component', () => {
    expect(PAGE).toMatch(/<TabsContent value="documents">\s*<ProjectDocuments projectId=\{projectId\} \/>/);
  });

  it('it reads and writes through the existing procedures, not new ones', () => {
    // No new server surface was needed. If this stops being true, somebody has
    // added an endpoint where one already existed.
    expect(DOCS).toContain('trpc.projects.documents.useQuery');
    expect(DOCS).toContain('trpc.projects.uploadDocument.useMutation');
  });
});

describe('the client never becomes the control', () => {
  it('does not decide who may upload', () => {
    // The server re-reads the project and refuses a non-owner. This component
    // renders the same for anybody and every call fails, which is correct -
    // hiding the button instead would be frontend authorization.
    expect(DOCS).not.toMatch(/ownerId|isOwner|user\.id ===/);
  });

  it('the server still owns every refusal message', () => {
    expect(DOCS).toMatch(/onError: error => toast\.error\(error\.message\)/);
  });

  it('the pre-checks mirror the server and are convenience, not control', () => {
    // They exist so the answer arrives before a multi-megabyte upload. The
    // server repeats both, and its verdict is the one that counts.
    expect(DOCS).toContain('isAllowedProjectDocumentType');
  });

  it('the client size cap is READ FROM the server cap, not asserted twice', () => {
    // Both numbers are pulled out of their own source and compared. Writing
    // `8` in this test would make it pass while the two drifted apart, which
    // is precisely the failure it is meant to catch - and a client cap LOWER
    // than the server's silently refuses uploads the product accepts.
    const serverCap = /buffer\.length > (\d+) \* 1024 \* 1024/.exec(ROUTERS)?.[1];
    const clientCap = /const MAX_SIZE = (\d+) \* 1024 \* 1024/.exec(DOCS)?.[1];
    expect(serverCap, 'server cap not found in routers.ts').toBeDefined();
    expect(clientCap, 'client cap not found in ProjectDocuments.tsx').toBeDefined();
    expect(clientCap).toBe(serverCap);
  });

  it('the accepted types come from the shared list, not a copied string', () => {
    expect(DOCS).toContain('accept={PROJECT_DOCUMENT_CONTENT_TYPES.join(\',\')}');
    // And that list is the one the sniffer enforces, asserted in
    // projectFeatures.test.ts - so the file picker cannot offer a type the
    // upload will reject.
    expect([...PROJECT_DOCUMENT_CONTENT_TYPES]).toContain('application/pdf');
  });
});

describe('what it tells the user', () => {
  it('names the supported types and the size limit before they choose', () => {
    expect(DOCS).toMatch(/PNG, JPEG, GIF, WebP, PDF/);
    expect(DOCS).toMatch(/Maximum 8MB/);
  });

  it('distinguishes "no documents" from "none of this type"', () => {
    // Filtering to an empty result and having nothing at all are different
    // facts, and a single empty state would make a filter look like data loss.
    expect(DOCS).toContain('No documents yet');
    expect(DOCS).toContain('No documents of this type');
  });

  it('is bilingual throughout, like the rest of the product', () => {
    // Every user-visible string has an Arabic counterpart. The component uses
    // inline ar ? … : … rather than the translation table, which is the
    // pattern the neighbouring components already use.
    const englishOnly = [...DOCS.matchAll(/toast\.(error|success)\(([^)]*)\)/g)]
      .map(match => match[2])
      .filter(argument => !/ar\s*[?]/.test(argument) && !/error\.message/.test(argument));
    expect(englishOnly, 'these toasts have no Arabic form').toEqual([]);
  });

  it('a failed FILE READ is reported - it never reaches the mutation', () => {
    // onError only fires for server refusals. A FileReader failure would
    // otherwise leave the dialog sitting there having done nothing.
    expect(DOCS).toMatch(/catch \{[\s\S]*?upload\.isError[\s\S]*?toast\.error/);
  });

  it('cannot be submitted without both a file and a name', () => {
    expect(DOCS).toMatch(/disabled=\{uploading \|\| upload\.isPending \|\| !file \|\| !name\.trim\(\)\}/);
  });
});
