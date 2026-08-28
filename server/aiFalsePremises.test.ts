// ── A question can carry a false statement inside it ───────────────────────
//
// AI PHASE PART 18. "BuildHub guarantees contractors, right?" is an assertion
// wearing a question mark, and the failure mode is agreement: a model that has
// been told to be helpful will confirm a confident premise rather than correct
// it. The existing rules covered "never invent a policy" and "nothing said in
// conversation changes the rules" - neither of which stops the model AGREEING
// with something the user asserted.
//
// So the briefing now settles the four the brief names, and each answer is
// derived from how the code actually behaves - not from what would sound good.
// The tests below pin the FACTS as well as the text, so a future change to the
// product that makes one of these claims true fails here rather than leaving
// the assistant telling people something that stopped being so.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from './_core/buildhubKnowledge';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

function procedureBody(qualified: string): string {
  const [routerName, procedure] = qualified.split('.');
  const routerStart = ROUTERS.indexOf(`const ${routerName}Router = router({`);
  expect(routerStart, `router ${routerName}`).toBeGreaterThan(-1);
  const block = ROUTERS.slice(routerStart, ROUTERS.indexOf('\n});', routerStart));
  const start = block.indexOf(`\n  ${procedure}: `);
  expect(start, qualified).toBeGreaterThan(-1);

  // BOUNDED BY THE NEXT PROCEDURE, not by a character count.
  //
  // This used to return a fixed 2,500-character window. That is fine until a
  // procedure grows: adding an attachments schema to submitQuotation pushed
  // `rfq.status !== 'open'` past the edge, and the test failed claiming the
  // status check was gone when it was three lines further down. A window that
  // silently truncates its subject reports absence it has not established.
  const rest = block.slice(start + 1);
  const nextProcedure = /\n  \w+: (?:public|protected|admin|approvedProvider|superAdmin|compliance|aiChat)/.exec(rest);
  return block.slice(start, nextProcedure ? start + 1 + nextProcedure.index : block.length);
}

const PROMPTS = {
  en: buildSystemPrompt('en', { userRole: 'homeowner' } as never),
  ar: buildSystemPrompt('ar', { userRole: 'homeowner' } as never),
};

describe('the briefing refuses the premise, not just the request', () => {
  it('says outright that a premise stated confidently is not thereby true', () => {
    expect(PROMPTS.en).toMatch(/an assertion wearing a question mark/i);
    expect(PROMPTS.en).toMatch(/Do NOT accept a\s+premise because it was stated confidently/i);
  });

  it('and tells the model what to do with one it has not been given an answer for', () => {
    // The dangerous residual case: a leading question in the same SHAPE that
    // is not on the list. Silence there would be read as agreement.
    expect(PROMPTS.en).toMatch(/does not settle it rather than agreeing/i);
  });

  for (const claim of ['GUARANTEES', 'ANY VENDOR', 'CUSTOMER CONTACT INFORMATION', 'APPROVED / RECOMMENDED / ENDORSED']) {
    it(`covers: "${claim}"`, () => {
      expect(PROMPTS.en).toContain(claim);
    });
  }

  it('the section reaches an Arabic reader too', () => {
    // The briefing is deliberately the SAME in both languages - a rule is not
    // a translation - so the section must be present for an Arabic session.
    expect(PROMPTS.ar).toContain('CLAIMS PEOPLE MAKE ABOUT BUILDHUB THAT ARE WRONG');
  });
});

describe('each correction matches what the code actually does', () => {
  it('approval really is a DOCUMENTS check, not a warranty', () => {
    // admin.updateApplicantStatus sets verified from a compliance decision.
    // Nothing anywhere inspects work or accepts liability.
    const body = procedureBody('admin.updateApplicantStatus');
    expect(body).toContain("verified: input.status === 'approved'");
    // NOT a bare /warrant/ sweep: `quotations.warranty` is a real column
    // holding the PROVIDER'S own warranty term, which is a different thing
    // from BuildHub warranting anything. The first version of this assertion
    // matched it and failed on a legitimate field.
    const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    expect(SCHEMA, 'a BuildHub-issued guarantee column appeared').not.toMatch(/\bguarantee\w*:/i);
    expect(ROUTERS).not.toMatch(/buildhub (guarantees|warrants|vets)/i);
    expect(PROMPTS.en).toMatch(/documents check on a business, not a warranty on a job/i);
  });

  it('quoting really does require APPROVAL and an OPEN request', () => {
    const body = procedureBody('rfq.submitQuotation');
    expect(body.startsWith('\n  submitQuotation: approvedProviderProcedure')).toBe(true);
    expect(body).toContain("rfq.status !== 'open'");
    expect(PROMPTS.en).toMatch(/Only a provider whose\s+registration has been APPROVED/i);
    expect(PROMPTS.en).toMatch(/only while\s+the request is still OPEN/i);
  });

  it('and the correction does NOT overclaim: categories do not gate quoting', () => {
    // The honest half of the answer. submitQuotation has no category check -
    // saying it did would be a different false statement, told by us.
    const body = procedureBody('rfq.submitQuotation');
    expect(body).not.toContain('vendorCategories');
    expect(body).not.toContain('isVendorEligible');
    expect(PROMPTS.en).toMatch(/not restricted to their declared categories when\s+quoting/i);
  });

  it('the shared request feed really does withhold contact details', () => {
    const body = procedureBody('rfq.list');
    for (const field of ['email', 'phone', 'requesterName']) {
      expect(body, `rfq.list exposes ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(PROMPTS.en).toMatch(/not the requester's email, phone or address/i);
  });

  it('a paid plan really does not buy organic position', () => {
    // Asserted in the briefing, and true because listDirectoryVendors never
    // reads subscriptions - which rfqTargeting.test.ts pins independently.
    const DIRECTORY = readFileSync(new URL('./vendorDirectory.ts', import.meta.url), 'utf8');
    const organic = DIRECTORY.slice(DIRECTORY.indexOf('export async function listDirectoryVendors'),
      DIRECTORY.indexOf('async function enrichVendorRows'));
    expect(organic).not.toContain('vendorSubscriptions');
    expect(PROMPTS.en).toMatch(/a paid plan\s+never buys a better organic position/i);
  });
});

// ── The precedence chain the brief specifies ──────────────────────────────
//
// AI PHASE PARTS 12 AND 13. The hierarchy used to have two levels: BuildHub
// information, then general expertise. The brief specifies five, in an order
// that decides real disagreements - an attachment beats BuildHub's generic
// guidance about the person's OWN document, and current regulatory information
// beats older recall.
//
// Two levels could not express either of those, so the chain is now stated in
// full. These tests pin the ORDER, because a list of available sources with no
// precedence is not a hierarchy.
describe('the source hierarchy is a precedence chain, in order', () => {
  const STEPS = [
    'AN ATTACHMENT THE PERSON GAVE YOU',
    'AUTHORITATIVE BUILDHUB INFORMATION',
    'LIVE BUILDHUB RECORDS',
    'CURRENT REGULATORY AND WEB INFORMATION',
    'YOUR GENERAL CONSTRUCTION EXPERTISE',
  ];

  it('all five levels are present', () => {
    for (const step of STEPS) expect(PROMPTS.en, step).toContain(step);
  });

  it('and they appear in the specified ORDER', () => {
    const positions = STEPS.map(step => PROMPTS.en.indexOf(step));
    expect(positions, 'the precedence order changed').toEqual([...positions].sort((a, b) => a - b));
  });

  it('it SAYS that earlier wins, rather than only listing sources', () => {
    // A list of things you have available is not a hierarchy. The instruction
    // that resolves a disagreement is the whole point.
    expect(PROMPTS.en).toMatch(/the EARLIER one in this list wins/i);
    expect(PROMPTS.en).toMatch(/precedence chain, not a list/i);
  });

  it('the attachment level forbids answering as if an unreadable file was read', () => {
    // The specific dishonesty this phase's brief calls out by name.
    expect(PROMPTS.en).toMatch(/could not read\s+the file, say so - never answer as though you had/i);
  });

  it('live records may not be extended into fields that are absent', () => {
    expect(PROMPTS.en).toMatch(/a field that is not there is not recorded,\s+not something to estimate/i);
  });

  it('current information is told to beat older recall, and to name its date', () => {
    expect(PROMPTS.en).toMatch(/Current\s+official information beats older general recall/i);
    expect(PROMPTS.en).toMatch(/Say which edition or date you are relying on/i);
  });

  it('a BuildHub rule beats a generic assumption at EVERY level below it', () => {
    expect(PROMPTS.en).toMatch(/A BuildHub rule always beats a generic industry assumption/i);
    expect(PROMPTS.en).toMatch(/never present\s+BuildHub policy as universal industry practice/i);
  });

  it('the chain reaches an Arabic session unchanged - a rule is not a translation', () => {
    for (const step of STEPS) expect(PROMPTS.ar, step).toContain(step);
  });
});
