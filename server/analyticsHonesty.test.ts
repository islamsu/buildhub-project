/**
 * ── NO METRIC BUILDHUB CANNOT PROVE ────────────────────────────────────
 *
 * §89 item 18: metrics must be query-backed and explainable; an outage must
 * not become zero; and there must be no fake traffic, CTR, inquiries,
 * conversions, ROI, revenue or trends.
 *
 * The audit found the FOUNDATION sound - `analyticsEvents` is a real typed
 * store, `placementPerformance` counts rows that exist, `rate()` returns
 * null rather than a decorative zero, and `analytics.myStats` is one
 * session-scoped aggregate with a single definition of "accepted". What was
 * missing was a rule that stops the next screen inventing one.
 *
 * SO THIS IS A CENSUS, not a spot check. It walks every product file and
 * fails on the shapes a fabricated metric actually takes - because the
 * defect never arrives labelled "fake": it arrives as a plausible constant
 * in a card that looks like every other card.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rate, rateIsMeaningful, MIN_RATE_SAMPLE } from '../shared/placementAnalytics';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

/**
 * The same stripping, for an ABSOLUTE path from the walker.
 *
 * `readSourceForAssertions` refuses a file whose comments are more than 90%
 * of it - a deliberate guard against a strip that silently ate the code. A
 * census must survive meeting one, so that case falls back to the raw text:
 * a false positive here is a written-down exception, which is cheap, while
 * a crash stops the census covering anything at all.
 */
function codeOf(absolute: string): string {
  const raw = readFileSync(absolute, 'utf8');
  try { return readSourceForAssertions(raw); } catch { return raw; }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const PRODUCT_FILES = [...walk(join(ROOT, 'client/src')), ...walk(join(ROOT, 'server')), ...walk(join(ROOT, 'shared'))];
const relative = (file: string) => file.slice(ROOT.length + 1);

describe('no figure is invented', () => {
  it('NOTHING RANDOM PRODUCES A NUMBER A USER READS', () => {
    /*
     * `Math.random()` in a metric is the purest form of the defect, and it
     * looks entirely normal in review.
     *
     * ONE DECLARED EXCEPTION, and it is not a metric: the shadcn sidebar
     * skeleton varies its placeholder WIDTH so a loading state does not look
     * like a barcode. It renders no number and carries no meaning.
     */
    const offenders = PRODUCT_FILES
      .filter(file => codeOf(file).includes('Math.random'))
      .map(relative);
    expect(offenders.sort()).toEqual(['client/src/components/ui/sidebar.tsx']);
  });

  it('and that one exception really is a skeleton width, not a figure', () => {
    // The allowlist is earned, not declared. If that line ever starts
    // producing something a reader could mistake for data, this fails.
    const sidebar = src('client/src/components/ui/sidebar.tsx');
    const line = sidebar.split('\n').find(l => l.includes('Math.random')) ?? '';
    expect(line).toMatch(/%`/);
    expect(line).toMatch(/width|Width/i.test(sidebar) ? /.*/ : /width/);
  });

  it('no forbidden commercial metric is computed anywhere', () => {
    /*
     * ROI, GMV, CPC, CPM and ARPU cannot be derived from anything in this
     * schema, so any occurrence is necessarily invented. Matched as an
     * ASSIGNMENT or a property, so prose explaining that these are absent
     * does not trip it.
     *
     * MRR IS THE ONE EXCEPTION, AND IT IS EARNED RATHER THAN DECLARED.
     * `server/analytics/kpis.ts` computes it from `vendorSubscriptions` -
     * the contractual record - priced from shared/billing.ts, deliberately
     * NOT from the analytics event stream, because an event stream is
     * allowed to drop a write and an owner reporting revenue cannot be
     * working from a lossy log. The next test checks that this is still how
     * it is computed, so the exception cannot survive the file changing.
     */
    const forbidden = /\b(roi|gmv|cpc|cpm|arpu)\s*[:=]\s*[^=]/i;
    const offenders = PRODUCT_FILES
      .filter(file => forbidden.test(codeOf(file)))
      .map(relative);
    expect(offenders, 'a commercial figure BuildHub cannot derive is being computed')
      .toEqual([]);

    const mrr = PRODUCT_FILES.filter(file => /\bmrr\s*[:=]\s*[^=]/i.test(codeOf(file))).map(relative);
    expect(mrr.sort(), 'a new surface computes MRR - it must be declared and backed')
      .toEqual(['server/analytics/kpis.ts']);
  });

  it('and the one revenue figure is backed by the contractual record, not by events', () => {
    // The exception above holds only while this remains true. If MRR ever
    // starts being derived from the event stream - or from nothing - this
    // fails and it goes back to being a forbidden invented figure.
    const kpis = src('server/analytics/kpis.ts');
    expect(kpis).toContain('vendorSubscriptions');
    expect(kpis, 'revenue is being derived from the lossy event stream')
      .not.toContain('analyticsEvents');
    // A trial has paid nothing. Counting one as revenue is the commonest way
    // a subscription business lies to itself.
    expect(kpis).toContain('trialingVendors');
  });

  it('and nothing claims a trend the product does not measure', () => {
    // "Trending" and "+12% this week" are claims about a time series. There
    // is no stored time series, so both would be fabricated (§25, §28).
    const offenders = PRODUCT_FILES
      .filter(file => /\btrendingQueries|fakeTrend|growthRate\s*[:=]/i.test(codeOf(file)))
      .map(relative);
    expect(offenders).toEqual([]);
  });
});

describe('a rate is arithmetic, and says when it is meaningless', () => {
  it('no denominator means NULL, never zero', () => {
    // §10: a rate over nothing is not 0%, it is undefined. Rendering 0%
    // asserts "nobody clicked", which is a different and false claim.
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
    expect(rate(0, -1)).toBeNull();
    expect(rate(Number.NaN, 10)).toBeNull();
    expect(rate(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('a real denominator produces a real rate, including a real zero', () => {
    // The other direction matters just as much: a true zero must not be
    // hidden, or a supplier cannot tell "no clicks" from "not measured".
    expect(rate(0, 10)).toBe(0);
    expect(rate(1, 4)).toBe(25);
    expect(rate(1, 3)).toBe(33.3);
  });

  it('and a true-but-worthless rate is gated on DISPLAY, not on the data', () => {
    /*
     * 0 clicks over 1 impression is arithmetically 0% and statistically
     * nothing. §68 prefers "Not enough data" to a misleading percentage.
     *
     * The gate is on display so the COUNTS stay identical everywhere - which
     * is what keeps a supplier's figure and an administrator's the same
     * number for the same placement.
     */
    expect(rateIsMeaningful(0)).toBe(false);
    expect(rateIsMeaningful(1)).toBe(false);
    expect(rateIsMeaningful(MIN_RATE_SAMPLE - 1)).toBe(false);
    expect(rateIsMeaningful(MIN_RATE_SAMPLE)).toBe(true);
    expect(rate(0, 1)).toBe(0);
  });
});

describe('an outage is never reported as a business fact', () => {
  it('the readers that ANSWER A QUESTION fail honestly', () => {
    /*
     * §10: ERROR != EMPTY, OUTAGE != ZERO. A database failure that renders
     * as "0 impressions, 0 enquiries" tells a supplier their promotion is
     * not working - a commercial claim made on no evidence.
     *
     * `requireDb` throws; `getDb` can return null and let a caller carry on
     * with an empty list. Every analytics READER must use the former.
     */
    for (const file of [
      'server/placementAnalytics.ts',
      'server/vendorMarketing.ts',
    ]) {
      expect(src(file), `${file} can answer a metric question during an outage`)
        .toContain('requireDb');
    }
  });

  it('and the surfaces that render them distinguish failure from emptiness', () => {
    for (const file of [
      'client/src/pages/MarketingCenterPage.tsx',
      'client/src/components/VendorAnalytics.tsx',
    ]) {
      const source = src(file);
      const observesFailure = /isError|error\b/.test(source);
      expect(observesFailure, `${file} cannot tell a failed read from an empty one`).toBe(true);
    }
  });

  it('the event WRITERS may swallow an outage, and that is the opposite rule', () => {
    // Failing somebody's page view because an impression could not be
    // counted is the worse outcome. A writer answers `{ recorded: false }`
    // rather than pretending it worked - it does not claim success either.
    expect(src('server/placementAnalytics.ts')).toContain('recorded: false');
  });
});

describe('the event vocabulary is closed and scrubbed', () => {
  it('a metric can only be built from a declared event type', () => {
    // An open-ended string column is how an invented event type gets
    // counted as though it meant something.
    const events = src('shared/analyticsEvents.ts');
    expect(events).toContain('export const ANALYTICS_EVENTS');
    expect(events).toContain('export function isAnalyticsEventType');
  });

  it('and personal data cannot ride along in event metadata', () => {
    // §65: do not expose PII to make a workflow look richer. The forbidden
    // key list is the enforcement.
    expect(src('shared/analyticsEvents.ts')).toContain('FORBIDDEN_METADATA_KEYS');
  });
});
