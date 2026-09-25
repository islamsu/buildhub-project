/**
 * ── FEATURED ≠ SPONSORED, IN THE PRESENTATION LAYER ────────────────────
 *
 * §89 item 17. The fresh audit found the ENGINE sound - `applyBoost` injects
 * nothing the organic query did not return, caps promotion at a third of the
 * page, and every heading and badge derives from one `label`. So this pins
 * the PRESENTATION rules that a live page can only partly prove: a page
 * showing one label kind cannot compare the pair.
 *
 * WHY THE PAIR MATTERS. Featured is BuildHub saying "we chose this". Sponsored
 * is "somebody paid for this". A buyer who cannot tell them apart is being
 * given BuildHub's editorial credibility for a commercial slot, which is the
 * one thing §18 and §68 both forbid.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { placementLabel, placementLabelText } from '../shared/placement';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));
const BADGE = src('client/src/components/MasterPlacement.tsx');

describe('the two labels are distinguishable without colour', () => {
  it('they are different WORDS in both languages', () => {
    for (const lang of ['en', 'ar']) {
      const featured = placementLabelText('FEATURED', lang);
      const sponsored = placementLabelText('SPONSORED', lang);
      expect(featured, `${lang} labels are identical`).not.toBe(sponsored);
      expect(featured.length).toBeGreaterThan(0);
      expect(sponsored.length).toBeGreaterThan(0);
    }
  });

  it('and the Arabic ones are genuinely Arabic', () => {
    const arabic = (value: string) => Array.from(value)
      .some(ch => (ch.codePointAt(0) ?? 0) >= 0x0600 && (ch.codePointAt(0) ?? 0) <= 0x06ff);
    expect(arabic(placementLabelText('FEATURED', 'ar'))).toBe(true);
    expect(arabic(placementLabelText('SPONSORED', 'ar'))).toBe(true);
  });

  it('and they carry DIFFERENT ICONS, not only different hues', () => {
    // Two badges distinguished only by hue are one stylesheet away from
    // being indistinguishable, and invisible to a colour-blind reader (§56).
    expect(BADGE).toContain('const Icon = sponsored ? Megaphone : BadgeCheck;');
    expect(BADGE).toContain('<Icon className="h-3.5 w-3.5" aria-hidden="true" />');
  });

  it('and the icon is hidden from assistive technology, because the word is there', () => {
    // An icon announced beside its own label reads the meaning twice.
    expect(BADGE).toMatch(/aria-hidden="true"/);
  });

  it('each badge is addressable, so a test can tell which one rendered', () => {
    expect(BADGE).toContain("data-testid={sponsored ? 'placement-sponsored' : 'placement-featured'}");
  });
});

describe('only money buys the word Sponsored', () => {
  it('a paid source is SPONSORED and every unpaid one is FEATURED', () => {
    expect(placementLabel('PAID_SPONSORSHIP')).toBe('SPONSORED');
    for (const unpaid of ['ADMIN_EDITORIAL', 'REFERRAL_REWARD', 'PROMOTIONAL_COMP', 'ADMIN_GRANT']) {
      expect(placementLabel(unpaid), unpaid).toBe('FEATURED');
    }
  });

  it('and an unknown source defaults to FEATURED, never to Sponsored', () => {
    // The default runs in this direction on purpose: an advertiser must not
    // silently inherit the editorial word, and a new PAID_* source has to be
    // classified deliberately.
    for (const unknown of ['', 'SOMETHING_NEW', null, undefined]) {
      expect(placementLabel(unknown as any)).toBe('FEATURED');
    }
  });

  it('the SLOT HEADING follows the same label as the badge', () => {
    /*
     * This heading used to read "Featured provider" whatever filled the slot,
     * so a PAID Master booking rendered under BuildHub's editorial word while
     * the badge two lines below said Sponsored. The two cannot contradict
     * each other now.
     */
    expect(BADGE).toContain('function masterSlotHeading(label: PlacementLabel');
    expect(BADGE).toMatch(/if \(label === 'SPONSORED'\)/);
    expect(BADGE).toMatch(/Sponsored provider/);
    expect(BADGE).toMatch(/Sponsored product/);
  });
});

describe('promotion re-ranks; it never invents', () => {
  const BOOST = src('server/publicPlacement.ts');

  it('only ids the organic query already returned can be lifted', () => {
    // The no-injection rule. Without it, buying a placement would put a
    // provider on a page the directory deliberately excluded them from -
    // an unapproved account, or one outside the filtered category.
    expect(BOOST).toContain('const liftable = boosted.filter(b => byId.has(b.id))');
  });

  it('and the page keeps its length - a lift is a move, not an insert', () => {
    expect(BOOST).toContain('out.length < organic.length');
  });

  it('promotion is capped, so it can never take the whole page', () => {
    expect(BOOST).toContain('MAX_BOOST_SHARE');
    expect(BOOST).toContain('SURFACE_CAPACITY.SEARCH_RESULTS_BOOST');
  });

  it('and an empty candidate list changes nothing', () => {
    // The fail-safe direction: no placements means the organic order stands,
    // rather than an empty filter matching everything.
    expect(BOOST).toContain('if (organic.length === 0 || boosted.length === 0) return organic;');
  });
});
