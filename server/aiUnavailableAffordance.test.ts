import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * WHAT AN AI TOOL CARD DOES WHEN THERE IS NO AI.
 *
 * The reported symptom that opened this audit was "the cards render but
 * clicking them does not take you anywhere". Driven live on a deployment where
 * auth.capabilities reports aiAssistant:false, the cards are NOT dead: they are
 * greyed, announced as disabled, given pointer-events:none so they do not even
 * show a hand cursor, and preceded above the fold by a notice that says in
 * plain words that this deployment has no AI provider.
 *
 * That is outcome (C) of the acceptance rule - intentionally not presented as
 * clickable - rather than a defect. These tests hold it there, because the
 * cheap "fix" for the symptom is to make the cards look normal again and let
 * the click fail silently.
 */

const PAGE = readFileSync(new URL('../client/src/pages/AIAssistantPage.tsx', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');

describe('when no AI provider is configured', () => {
  it('the page asks the server rather than guessing', () => {
    expect(PAGE).toContain('trpc.auth.capabilities.useQuery()');
    expect(PAGE).toContain('capabilities?.aiAssistant === false');
  });

  it('the cards stop being clickable, rather than looking clickable and failing', () => {
    // pointer-events:none is what removes the hand cursor. Without it the card
    // still invites the click it cannot honour.
    expect(PAGE).toContain("aiUnavailable ? 'opacity-50 pointer-events-none'");
    expect(PAGE).toContain('aria-disabled={aiUnavailable}');
  });

  it('the handler refuses too, so the affordance is not the only guard', () => {
    // A CSS class is a presentation choice; a real user with a stylesheet
    // blocked, or an automated click, must still send nothing.
    expect(PAGE).toContain('onClick={() => { if (!aiUnavailable) handleSend(');
  });

  it('the composer is disabled as well, not just the cards', () => {
    expect(PAGE).toContain('disabled={aiUnavailable}');
  });

  it('a notice explains why, in both languages', () => {
    expect(PAGE).toContain("{aiUnavailable && (");
    expect(PAGE).toContain("t('ai.unavailable.title')");
    expect(PAGE).toContain("t('ai.unavailable.body')");
    for (const key of ['ai.unavailable.title', 'ai.unavailable.body']) {
      expect(I18N.split(`'${key}':`).length - 1, `${key} must exist in EN and AR`).toBe(2);
    }
  });

  it('and the notice says what is wrong without blaming the reader', () => {
    // It names the deployment's missing provider, and says the rest of the
    // product still works - which is the fact a reader needs.
    const at = I18N.indexOf("'ai.unavailable.body':");
    const body = I18N.slice(at, at + 260);
    expect(body).toMatch(/no AI provider configured/i);
    expect(body).toMatch(/Everything else on BuildHub works normally/i);
  });

  it('the notice is rendered ABOVE the cards', () => {
    // Below them it is an explanation the reader finds after being confused.
    const noticeAt = PAGE.indexOf("{aiUnavailable && (");
    const cardsAt = PAGE.indexOf('data-testid="ai-tools"');
    expect(noticeAt).toBeGreaterThan(-1);
    expect(cardsAt).toBeGreaterThan(-1);
    expect(noticeAt, 'the unavailable notice must precede the tool grid').toBeLessThan(cardsAt);
  });
});
