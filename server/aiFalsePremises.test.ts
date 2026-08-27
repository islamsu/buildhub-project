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
  return block.slice(start, start + 2500);
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
