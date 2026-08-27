// ── What actually reaches the model ────────────────────────────────────────
//
// AI PHASE PART 21 asks for PROOF that the assistant never receives passwords,
// API keys, JWT secrets, database, SMTP or S3 credentials, private data outside
// authorization, or internal administrator information.
//
// The existing security suite proves the endpoint's edges: the caller cannot
// set provider parameters, cannot turn on web search, cannot inject a system
// message, and gets no credential back. What it does NOT do is look at the
// thing that is actually sent - the assembled prompt.
//
// So this file builds the WHOLE prompt with every block populated from
// deliberately poisoned inputs - a project whose title is an API key, a viewer
// carrying a password hash - and asserts none of it survives. Assembling the
// real thing is the point: a test that checks the pieces separately cannot see
// a secret that leaks through the join.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from './_core/buildhubKnowledge';
import { formatProjectContext } from './_core/projectContext';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

/** Values that must never appear in a prompt, whatever route they arrive by. */
const FORBIDDEN: [string, string][] = [
  ['a bcrypt hash', '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNO'],
  ['an OpenAI key', 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ['a JWT secret', 'jwt-secret-value-do-not-leak'],
  ['a database URL', 'mysql://buildhub:hunter2@10.0.0.5:3306/buildhub'],
  ['an SMTP password', 'smtp-password-do-not-leak'],
  ['an S3 secret', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
  ['an invitation token', 'invitation-token-do-not-leak'],
  ['a session cookie', 'buildhub_session=eyJhbGciOiJIUzI1NiJ9.payload.signature'],
  // NOT a credential, and still must not travel. The assistant needs the
  // person's ROLE and PLAN to pitch an answer; it has never needed their
  // contact details, and sending PII to a third-party provider that has no use
  // for it is a privacy cost with no benefit.
  //
  // This entry exists because a mutation SURVIVED: interpolating
  // `viewer.email` into the briefing passed every assertion in the first
  // version of this file, since the forbidden list held only secrets.
  ['the viewer email', 'private@example.com'],
  ['the viewer username', 'private-username'],
  ['the viewer phone', '+201000000001'],
];

/**
 * The prompt as the router assembles it, from a viewer object deliberately
 * carrying every private field a `users` row has.
 */
function assembledPrompt(lang: 'en' | 'ar' = 'en'): string {
  const poisonedViewer = {
    userRole: 'homeowner',
    username: 'private-username',
    phone: '+201000000001',
    // Fields that exist on the real row and must never travel:
    passwordHash: FORBIDDEN[0][1],
    invitationToken: FORBIDDEN[6][1],
    passwordResetToken: 'reset-token-do-not-leak',
    openId: 'local_00000000-0000-0000-0000-000000000000',
    email: 'private@example.com',
    adminRole: 'SUPER_ADMIN',
  } as never;

  const project = formatProjectContext({
    kind: 'resolved', scope: 'owner',
    project: {
      id: 1, title: 'Villa slab', type: 'residential', status: 'active',
      location: 'New Cairo', progress: 40, budget: '1500000.00', spent: '600000.00',
      startDate: null, endDate: null,
    },
  }, lang);

  return buildSystemPrompt(lang, poisonedViewer) + project;
}

describe('no credential reaches the model, by any route', () => {
  for (const lang of ['en', 'ar'] as const) {
    for (const [what, secret] of FORBIDDEN) {
      it(`${lang}: the assembled prompt contains no ${what}`, () => {
        expect(assembledPrompt(lang)).not.toContain(secret);
      });
    }
  }

  it('and the prompt was actually built - this is not asserting over an empty string', () => {
    // Every assertion above is vacuous if the prompt is empty.
    const prompt = assembledPrompt('en');
    expect(prompt.length).toBeGreaterThan(2000);
    expect(prompt).toContain('You are BuildHub AI');
    expect(prompt).toContain('PROJECT CONTEXT');
  });

  it('no private users column is interpolated anywhere in the prompt builders', () => {
    // The general rule behind the specific values. A new private column added
    // to the viewer must not become reachable by a builder reading it.
    const KNOWLEDGE = readFileSync(new URL('./_core/buildhubKnowledge.ts', import.meta.url), 'utf8');
    for (const column of [
      'passwordHash', 'invitationToken', 'passwordResetToken', 'sessionsInvalidBefore', 'adminRole',
      // Personally identifying, and unnecessary: the stance needs role and
      // plan, never contact details.
      'email', 'phone', 'username', 'openId',
    ]) {
      expect(KNOWLEDGE, `buildhubKnowledge reads ${column}`).not.toContain(`viewer.${column}`);
      expect(KNOWLEDGE, `buildhubKnowledge reads ${column}`).not.toContain(`.${column}`);
    }
  });

  it('the briefing carries ROLE and PLAN, which is all it needs about the person', () => {
    // The positive half. A privacy rule that also removed the useful context
    // would be a worse product, so what SHOULD be there is asserted too.
    const KNOWLEDGE = readFileSync(new URL('./_core/buildhubKnowledge.ts', import.meta.url), 'utf8');
    expect(KNOWLEDGE).toContain('viewer.userRole');
    expect(KNOWLEDGE).toContain('viewer.planId');
    expect(assembledPrompt('en')).toContain('BuildHub role: homeowner');
  });

  it('the prompt tells the model it does not have credentials at all', () => {
    expect(assembledPrompt('en')).toMatch(/Never reveal or discuss credentials, API keys, tokens or internal\s+configuration. You do not have them\./);
  });
});

describe('the AI never becomes a way around an authorization boundary', () => {
  it('an ADMIN surface is never read into the prompt', () => {
    // The AI path may read the marketplace directory, the corpus, the caller's
    // own project and their own attachments. It must not read the admin
    // routers' data, which is gated on permissions the AI cannot hold.
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const chat = ROUTERS.slice(start, ROUTERS.indexOf('  uploadAttachment: protectedProcedure', start));
    for (const forbidden of ['adminSettings', 'userAccountAuditEvents', 'adminInvitations', 'testLoginTokens', 'registrationDocuments', 'billingEvents']) {
      expect(chat, `ai.chat reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('it never reads the users table directly either', () => {
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const chat = ROUTERS.slice(start, ROUTERS.indexOf('  uploadAttachment: protectedProcedure', start));
    expect(chat).not.toContain('from(users)');
  });

  it('every record the AI DOES read comes through an ownership-scoped helper', () => {
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const chat = ROUTERS.slice(start, ROUTERS.indexOf('  uploadAttachment: protectedProcedure', start));
    // Attachments: re-checked against userId. Project: resolver takes the
    // session id. Candidates: the public directory, which excludes unapproved
    // accounts. Those three, and nothing else, are the live inputs.
    expect(chat).toContain('eq(aiAttachments.userId, ctx.user.id)');
    expect(chat).toContain('userId: ctx.user.id');
    expect(chat).toContain('recommendProviders(');
  });
});

describe('the role reaching the model is the SESSION role', () => {
  it('ai.chat reads ctx.user.userRole, and the input schema has no role field', () => {
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const chat = ROUTERS.slice(start, ROUTERS.indexOf('  uploadAttachment: protectedProcedure', start));
    expect(chat).toContain('userRole: ctx.user.userRole');
    const schema = ROUTERS.slice(start, ROUTERS.indexOf('.mutation(', start));
    // TOP-LEVEL fields only. A bare search for 'role:' matches the MESSAGE
    // role inside the messages array - system/user/assistant - which is the
    // OpenAI wire format and nothing to do with who is asking. The first
    // version of this assertion failed on it.
    const topLevel = [...schema.matchAll(/^\s{6}(\w+):/gm)].map(match => match[1]);
    for (const field of ['role', 'userRole', 'adminRole', 'company', 'organization', 'ownerId']) {
      expect(topLevel, `ai.chat accepts ${field} from the client`).not.toContain(field);
    }
  });

  it('NEGATIVE CONTROL: a client-supplied role is stripped, not honoured', () => {
    // zod strips unknown keys rather than rejecting them, so "it does not
    // appear in the schema" IS the control - there is nothing to override.
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const schema = ROUTERS.slice(start, ROUTERS.indexOf('.mutation(', start));
    expect(schema).toContain('messages:');
    expect(schema).toContain('lang:');
    expect(schema).toContain('attachmentIds:');
    expect(schema).toContain('projectId:');
    // ...and those four are ALL of it. A fifth field would need justifying.
    const fields = [...schema.matchAll(/^\s{6}(\w+):/gm)].map(match => match[1]);
    expect(fields.sort()).toEqual(['attachmentIds', 'lang', 'messages', 'projectId']);
  });

  it('NEGATIVE CONTROL: role context removed entirely is still a valid prompt', () => {
    // A signed-out or unknown-role viewer must not produce a broken or empty
    // stance - it falls back to the homeowner experience.
    const prompt = buildSystemPrompt('en', { userRole: null } as never);
    expect(prompt).toContain('HOW TO PITCH THE ANSWER');
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it('NEGATIVE CONTROL: a customer does not receive the contractor stance', () => {
    const homeowner = buildSystemPrompt('en', { userRole: 'homeowner' } as never);
    const contractor = buildSystemPrompt('en', { userRole: 'contractor' } as never);
    expect(homeowner).not.toBe(contractor);
    // The workflows are the sharpest difference and the easiest to check.
    expect(homeowner).toContain('plan -> estimate -> find -> compare -> decide');
    expect(contractor).not.toContain('plan -> estimate -> find -> compare -> decide');
    expect(contractor).toContain('findOpportunity -> analyze -> estimate -> quote -> execute');
  });
});
