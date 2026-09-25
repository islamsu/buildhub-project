/**
 * ── A LINK IS NOT A JOURNEY ─────────────────────────────────────────────
 *
 * The shortlist's primary action navigated to `/rfq` and nothing else. The
 * buyer arrived at an EMPTY create form, and the eleven suppliers and six
 * products they had spent two days comparing were left behind on the page
 * they came from. Every individual piece worked; nothing connected them.
 *
 * CLAUDE.md §6 is the rule this file exists for: a capability is not a
 * product journey, and the questions are "can the user complete it" and
 * "does the next part of the product know it happened". The answer to the
 * second was no, and it looked like a finished feature from either end.
 *
 * WHAT IS PINNED HERE:
 *
 *   the ids a URL may carry are BOUNDED and parsed one way, in shared/
 *   selected products become basket lines through the canonical reducer
 *   selected providers become real invitations through rfq.inviteSupplier
 *   ONE refused invitation does not take the others down with it
 *   and the form SAYS what it is carrying before it is submitted
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  inviteParam, MAX_CARRIED_INVITATIONS, parseInviteIds,
  addToBasket, MAX_BASKET_ITEMS,
} from '../shared/rfqBasket';
import { readSourceForAssertions } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const src = (relative: string) => readSourceForAssertions(read(relative));

const SAVED = src('../client/src/pages/SavedPage.tsx');
const RFQ = src('../client/src/pages/RFQPage.tsx');

describe('what a URL may carry is bounded and parsed once', () => {
  it('reads a single id, the old spelling, unchanged', () => {
    // Every `/rfq?invite=5` link already in circulation - from a storefront,
    // from a bookmark - has to keep working.
    expect(parseInviteIds('5')).toEqual([5]);
  });

  it('and a list', () => {
    expect(parseInviteIds('5,9,12')).toEqual([5, 9, 12]);
  });

  it('refuses everything that is not a positive integer id', () => {
    // A URL is user-controlled input. `Number('')` is 0 and `Number(' 1 ')`
    // is 1, so an empty segment from a trailing comma must be rejected
    // before it becomes an id.
    for (const hostile of ['', '0', '-3', 'abc', '1.5', '1e3', ' ', ',', ',,', '5,', null, undefined]) {
      const ids = parseInviteIds(hostile as any);
      expect(ids.every(id => Number.isInteger(id) && id > 0), String(hostile)).toBe(true);
    }
    expect(parseInviteIds('0,-1,abc')).toEqual([]);
    expect(parseInviteIds('5,')).toEqual([5]);
    expect(parseInviteIds('abc,7')).toEqual([7]);
  });

  it('de-duplicates, because inviting the same supplier twice is one invitation', () => {
    expect(parseInviteIds('5,5,5')).toEqual([5]);
  });

  it('IS BOUNDED - a shortlist holds 200 and a URL is not a broadcast list', () => {
    const many = Array.from({ length: 50 }, (_, index) => index + 1).join(',');
    expect(parseInviteIds(many)).toHaveLength(MAX_CARRIED_INVITATIONS);
    expect(MAX_CARRIED_INVITATIONS).toBeLessThan(50);
  });

  it('and the writer is bounded by the same number as the reader', () => {
    // A writer that emits more than the reader accepts loses ids silently,
    // which is the shortlist being dropped again one layer down.
    const ids = Array.from({ length: 40 }, (_, index) => index + 1);
    const written = inviteParam(ids);
    expect(written.split(',')).toHaveLength(MAX_CARRIED_INVITATIONS);
    expect(parseInviteIds(written)).toHaveLength(MAX_CARRIED_INVITATIONS);
  });

  it('round-trips, so what is written is what is read', () => {
    const ids = [3, 17, 42];
    expect(parseInviteIds(inviteParam(ids))).toEqual(ids);
  });

  it('the writer refuses a hostile id rather than emitting it', () => {
    expect(inviteParam([0, -1, 1.5, 7] as number[])).toBe('7');
  });
});

describe('the shortlist carries its selection into the request', () => {
  it('the action does more than navigate', () => {
    // The whole defect in one assertion: the button used to be
    // `onClick={() => navigate('/rfq')}`.
    expect(SAVED).toContain('data-testid="saved-request-quotes"');
    expect(SAVED).toContain('onClick={requestQuotations}');
    expect(SAVED, 'the button navigates to an empty form again')
      .not.toMatch(/data-testid="saved-request-quotes"[\s\S]{0,200}navigate\('\/rfq'\)/);
  });

  it('products go through the CANONICAL basket, not a second store', () => {
    // §11: one canonical domain. A second encoding of a basket line is how
    // the browser and the server stop agreeing about the limits.
    expect(SAVED).toContain("from '@/hooks/useRfqBasket'");
    expect(SAVED).toContain('basket.add({');
    expect(SAVED, 'a basket was written to localStorage directly')
      .not.toContain('localStorage.setItem');
  });

  it('providers go through the CANONICAL invitation, not a second channel', () => {
    expect(SAVED).toContain('inviteParam(');
    expect(RFQ).toContain('trpc.rfq.inviteSupplier.useMutation');
    expect(SAVED, 'the shortlist invites suppliers itself')
      .not.toContain('inviteSupplier.mutate');
  });

  it('and each item can be left out', () => {
    // Carrying the whole shortlist with no way to narrow it is the same
    // failure in the other direction: a buyer comparing eleven suppliers
    // does not want to invite all eleven.
    expect(SAVED).toContain('data-testid={`saved-pick-provider-${target.id}`}');
    expect(SAVED).toContain('data-testid={`saved-pick-product-${target.id}`}');
    // Each checkbox names WHAT it selects - a row of unlabelled checkboxes
    // is unusable with a screen reader (§62).
    expect(SAVED).toMatch(/aria-label=\{ar[\s\S]{0,200}Include \$\{target\.name\}/);
  });

  it('selecting nothing disables the action rather than sending an empty request', () => {
    expect(SAVED).toContain('disabled={pickedCount === 0}');
    expect(SAVED).toContain('data-testid="saved-selection-summary"');
  });

  it('the default is EVERYTHING, held as exclusions so a new item is included', () => {
    // A selection set would silently drop an item saved while the page was
    // open - the buyer ticked nothing, so they meant their shortlist.
    expect(SAVED).toContain('const [excluded, setExcluded]');
    expect(SAVED).toContain('const isPicked = (kind: string, id: number) => !excluded.has(');
  });

  it('and the basket cap is said out loud rather than swallowed', () => {
    // `addToBasket` refuses SILENTLY past the cap. A buyer who selected nine
    // and got six with no explanation concludes the page is broken.
    const ninth = Array.from({ length: MAX_BASKET_ITEMS }, (_, index) => index).reduce(
      (items, index) => addToBasket(items, {
        productId: index + 1, name: `p${index}`, variantLabel: null,
        quantity: 1, unit: null, specifications: null, unitPrice: null,
      }),
      [] as any[],
    );
    expect(ninth).toHaveLength(MAX_BASKET_ITEMS);
    const overflowed = addToBasket(ninth, {
      productId: 9999, name: 'one too many', variantLabel: null,
      quantity: 1, unit: null, specifications: null, unitPrice: null,
    });
    expect(overflowed, 'addToBasket stopped refusing past the cap').toHaveLength(MAX_BASKET_ITEMS);
    expect(SAVED).toContain('could not be added because the request is full');
  });
});

describe('the request form says what it is carrying', () => {
  it('names the suppliers that will be invited, before the request is posted', () => {
    // A form that silently carries four invitations is the same defect as a
    // basket that silently contains things: the buyer cannot check it, and
    // the first they learn of it is a toast after the fact.
    expect(RFQ).toContain('data-testid="rfq-invite-carry"');
    expect(RFQ).toContain('data-testid={`rfq-invite-carry-${supplier.id}`}');
  });

  it('and names an unknown id rather than inventing a name for it', () => {
    // The names come from the buyer's OWN shortlist. An id that is not on it
    // - a hand-typed URL - gets its reference, not a fabricated label (§68).
    expect(RFQ).toContain('`#${id}`');
  });

  it('and does not let the buyer think an invitation narrows the audience', () => {
    // The RFQ is still public to every provider whose declared categories
    // match it. A buyer who believes they have chosen four recipients has
    // been told something false about who can see their requirement.
    expect(RFQ).toMatch(/an invitation is in addition to that, not instead of it/i);
  });

  it('ONE REFUSED INVITATION DOES NOT TAKE THE OTHERS DOWN', () => {
    // An unapproved provider is refused by the server. Sending the four as
    // one all-or-nothing batch would lose three good invitations to it, and
    // reporting "4 invited" would be worse still.
    expect(RFQ).toContain('Promise.allSettled');
    expect(RFQ).toContain('invitedSupplierIds.map(supplierId =>');
    expect(RFQ).toMatch(/a supplier could not be invited/i);
  });

  it('and the count reported is the count that succeeded', () => {
    expect(RFQ).toContain('outcomes.filter(outcome => outcome.ok).length');
    expect(RFQ).toMatch(/invited to your request/);
  });
});
