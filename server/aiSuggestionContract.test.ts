/**
 * ── THE ASSISTANT MAY NOT ASK A QUESTION ON YOUR BEHALF ─────────────────
 *
 * The defect these tests exist for was two lines:
 *
 *   AIChatBox      onClick={() => onSendMessage(prompt)}
 *   AIAssistantPage onClick={() => handleSend(t(mode.promptKey))}
 *
 * Both put text the PRODUCT wrote into the transcript as `role: 'user'` and
 * submitted it in the same tick. Afterwards the conversation held a question
 * attributed to a person who had never typed it, never read it and could not
 * have edited it - and every later answer was grounded on it.
 *
 * A transcript is the record of what somebody asked. These assertions are about
 * keeping that record true, which is why several of them read the source: the
 * rule is "no code path does this", and only the source can say that.
 *
 * The second half is that suggestions must actually DIFFER by context. A
 * context-aware engine that returns the same list for every context is the old
 * defect - six fixed strings for everyone - wearing a new name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  suggestionsFor, isAutoSubmittable, SUGGESTION_SUBJECTS,
  type SuggestionContext, type Suggestion,
} from '../shared/aiSuggestions';

const ROOT = join(import.meta.dirname, '..');
const code = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

const ctx = (over: Partial<SuggestionContext> = {}): SuggestionContext =>
  ({ subject: 'general', role: 'homeowner', relation: 'requester', ...over });

const ids = (list: Suggestion[]) => list.map(s => s.id);
const labels = (list: Suggestion[]) => list.flatMap(s => [s.labelEn, s.labelAr]);
const prompts = (list: Suggestion[]) => list.flatMap(s => [s.promptEn ?? '', s.promptAr ?? '']);

describe('NOTHING A SUGGESTION CARRIES CAN SUBMIT IT', () => {
  it('there are exactly two kinds, and neither of them sends', () => {
    for (const subject of SUGGESTION_SUBJECTS) {
      for (const relation of ['requester', 'provider'] as const) {
        for (const suggestion of suggestionsFor(ctx({ subject, relation }))) {
          expect(['prompt', 'navigate']).toContain(suggestion.kind);
          expect(isAutoSubmittable(suggestion)).toBe(false);
        }
      }
    }
  });

  it('no suggestion carries a field that could mean "send this"', () => {
    const forbidden = ['autoSubmit', 'submit', 'send', 'auto', 'immediate'];
    for (const subject of SUGGESTION_SUBJECTS) {
      for (const suggestion of suggestionsFor(ctx({ subject }))) {
        for (const key of Object.keys(suggestion)) {
          expect(forbidden, `${subject}/${suggestion.id} carries ${key}`).not.toContain(key);
        }
      }
    }
  });

  it('a navigate suggestion has a route and no prompt, so it asks nothing', () => {
    const all = SUGGESTION_SUBJECTS.flatMap(subject =>
      suggestionsFor(ctx({ subject, subjectId: 7 })));
    const navigates = all.filter(s => s.kind === 'navigate');
    expect(navigates.length).toBeGreaterThan(0);
    for (const suggestion of navigates) {
      expect(suggestion.href, suggestion.id).toBeTruthy();
      expect(suggestion.promptEn).toBeUndefined();
      expect(suggestion.promptAr).toBeUndefined();
    }
  });

  it('a prompt suggestion has text in BOTH languages and no route', () => {
    const all = SUGGESTION_SUBJECTS.flatMap(subject => suggestionsFor(ctx({ subject })));
    const asks = all.filter(s => s.kind === 'prompt');
    expect(asks.length).toBeGreaterThan(0);
    for (const suggestion of asks) {
      expect(suggestion.promptEn, suggestion.id).toBeTruthy();
      expect(suggestion.promptAr, suggestion.id).toBeTruthy();
      expect(suggestion.href).toBeUndefined();
    }
  });
});

describe('and no CODE PATH sends one either', () => {
  const chatBox = code('client/src/components/AIChatBox.tsx');
  const page = code('client/src/pages/AIAssistantPage.tsx');

  it('choosing a suggested prompt fills the composer instead of sending it', () => {
    expect(chatBox).not.toContain('onSendMessage(prompt)');
    expect(chatBox).toContain('setInput(prompt)');
  });

  it('a tool card offers its prompt instead of submitting it', () => {
    expect(page).not.toContain('handleSend(t(mode.promptKey))');
    expect(page).toContain('offer(t(mode.promptKey))');
  });

  it('and a context suggestion offers too', () => {
    // Every onClick on the suggestion strip goes through `offer`, which sets a
    // draft; none of them reaches handleSend.
    const strip = page.slice(page.indexOf('ai-context-suggestions'));
    expect(strip).toContain('onClick={() => offer(');
    const upToActions = strip.slice(0, strip.indexOf('ai-actions'));
    expect(upToActions).not.toContain('handleSend(');
  });

  it('handleSend is reached ONLY from the composer\'s own submit', () => {
    /*
     * The composer is the one place a person's own words become a message. If
     * this count ever rises, something else has started speaking for them.
     */
    const calls = page.match(/handleSend\(/g) ?? [];
    // One definition, one hand-off to the chat box's onSendMessage. Nothing else.
    expect(calls.length, page.match(/handleSend\([^)]*\)/g)?.join(' | ')).toBeLessThanOrEqual(2);
    expect(page).toContain('onSendMessage={handleSend}');
  });

  it('the suggestions endpoint does not call the model or append a message', () => {
    const routers = code('server/routers.ts');
    const procedure = routers.slice(
      routers.indexOf('suggestions: protectedProcedure'),
      routers.indexOf('chat: aiChatProcedure'));
    expect(procedure.length).toBeGreaterThan(200);
    expect(procedure).not.toContain('generateAIResponse');
    expect(procedure).not.toContain("role: 'user'");
  });
});

describe('suggestions differ by ROLE', () => {
  it('a contractor and a homeowner opening the same category get different offers', () => {
    const homeowner = suggestionsFor(ctx({ subject: 'category', subtype: 'Renovation', isFinishing: true }));
    const contractor = suggestionsFor(ctx({
      subject: 'category', subtype: 'Renovation', isFinishing: true,
      role: 'contractor', relation: 'provider',
    }));
    expect(ids(homeowner)).not.toEqual(ids(contractor));
    expect(ids(homeowner).some(id => ids(contractor).includes(id))).toBe(false);
  });

  it('the homeowner opening تشطيب gets the four actions the spec names', () => {
    const list = suggestionsFor(ctx({ subject: 'category', subtype: 'Renovation', isFinishing: true }));
    const text = [...labels(list), ...prompts(list)].join(' ');
    expect(text).toContain('إنشاء طلب تشطيب');
    expect(text).toContain('ساعدني في تحديد مستوى التشطيب');
    expect(text).toContain('تقدير الميزانية');
    expect(text).toContain('شرح خيارات التشطيب');
  });

  it('and a provider is never offered "create a finishing request"', () => {
    const list = suggestionsFor(ctx({
      subject: 'category', subtype: 'Renovation', isFinishing: true,
      role: 'contractor', relation: 'provider',
    }));
    expect(labels(list).join(' ')).not.toContain('إنشاء طلب تشطيب');
  });
});

describe('suggestions differ by WORKFLOW STAGE', () => {
  const requester = (over: Partial<SuggestionContext> = {}) =>
    suggestionsFor(ctx({ subject: 'request', subjectId: 42, isFinishing: true, ...over }));

  it('before any quotation, the requester is helped to make the request answerable', () => {
    const list = requester({ quotationCount: 0 });
    expect(ids(list)).toContain('req-quality');
    expect(ids(list)).not.toContain('req-compare');
  });

  it('ONCE QUOTATIONS EXIST the suggestions change to the three the spec names', () => {
    const list = requester({ quotationCount: 3 });
    const text = [...labels(list), ...prompts(list)].join(' ');
    expect(text).toContain('قارن العروض');
    expect(text).toContain('ما البنود غير المشمولة؟');
    expect(text).toContain('اشرح فرق الأسعار');
    // And the earlier stage's offers are gone: the work has moved on.
    expect(ids(list)).not.toContain('req-quality');
  });

  it('which is a real change, not an addition', () => {
    expect(ids(requester({ quotationCount: 0 }))).not.toEqual(ids(requester({ quotationCount: 2 })));
  });
});

describe('suggestions differ by OBJECT', () => {
  it('a request, a quotation, a provider and a BOQ line all differ', () => {
    const seen = new Map<string, string[]>();
    for (const subject of ['request', 'quotation', 'provider', 'boq_item', 'project'] as const) {
      seen.set(subject, ids(suggestionsFor(ctx({ subject, subjectId: 5 }))));
    }
    const lists = Array.from(seen.values()).map(list => list.join('|'));
    expect(new Set(lists).size).toBe(lists.length);
  });

  it('and the subtype reaches the prompt, so two categories do not read alike', () => {
    const tiles = suggestionsFor(ctx({ subject: 'category', subtype: 'Flooring' }));
    const doors = suggestionsFor(ctx({ subject: 'category', subtype: 'Carpentry' }));
    expect(prompts(tiles).join(' ')).toContain('Flooring');
    expect(prompts(doors).join(' ')).toContain('Carpentry');
  });
});

describe('the contractor on a published request gets the five the spec names', () => {
  const list = suggestionsFor(ctx({
    subject: 'request', subjectId: 42, role: 'contractor', relation: 'provider',
    status: 'open', canRespond: true, isFinishing: true,
  }));

  it('all five, in Arabic', () => {
    const text = [...labels(list), ...prompts(list)].join(' ');
    expect(text).toContain('إعداد عرض سعر');
    expect(text).toContain('تحديد المعلومات الناقصة');
    expect(text).toContain('طلب توضيح');
    expect(text).toContain('حساب السعر');
    expect(text).toContain('إنشاء باقة');
  });

  it('and a provider who may NOT respond is told that instead of being offered a bid', () => {
    const blocked = suggestionsFor(ctx({
      subject: 'request', subjectId: 42, role: 'contractor', relation: 'provider',
      status: 'open', canRespond: false,
    }));
    expect(ids(blocked)).toContain('req-eligibility');
    expect(ids(blocked)).not.toContain('req-prepare');
  });
});

describe('the unknown fields drive help for exactly those fields', () => {
  it('a requester who said they do not know the level is offered that explanation', () => {
    const list = suggestionsFor(ctx({
      subject: 'request', subjectId: 9, quotationCount: 0, unknownFields: ['level'],
    }));
    expect(ids(list)).toContain('help-level');
    expect(ids(list)).not.toContain('help-area');
  });

  it('and one who answered everything is offered none of it', () => {
    const list = suggestionsFor(ctx({ subject: 'request', subjectId: 9, quotationCount: 0, unknownFields: [] }));
    expect(ids(list).filter(id => id.startsWith('help-'))).toEqual([]);
  });

  it('two unknowns produce two offers, in the order declared', () => {
    const list = suggestionsFor(ctx({
      subject: 'request', subjectId: 9, quotationCount: 0,
      unknownFields: ['areaSqm', 'level'],
    }));
    expect(ids(list).filter(id => id.startsWith('help-'))).toEqual(['help-area', 'help-level']);
  });
});

describe('the engine cannot leak what it was never given', () => {
  it('the context type carries no commercial or identifying field', () => {
    const module = code('shared/aiSuggestions.ts');
    const type = module.slice(module.indexOf('export type SuggestionContext'),
      module.indexOf('export type Suggestion ='));
    for (const forbidden of ['budget', 'ownerId', 'email', 'phone', 'contact', 'price', 'spent']) {
      expect(type, `SuggestionContext exposes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('and no generated prompt interpolates a figure', () => {
    // A prompt that carried a budget or a rival's price into the model's
    // context would defeat the authorization boundary by the back door.
    for (const subject of SUGGESTION_SUBJECTS) {
      for (const text of prompts(suggestionsFor(ctx({ subject, subjectId: 3 })))) {
        expect(text).not.toMatch(/\d{4,}/);
      }
    }
  });

  it('the server counts rival bids ONLY for the requester', () => {
    const routers = code('server/routers.ts');
    const procedure = routers.slice(routers.indexOf('suggestions: protectedProcedure'));
    expect(procedure.slice(0, 6000)).toContain('if (isRequester) {');
    expect(procedure.slice(0, 6000)).toContain('quotationCount = Number');
  });
});
