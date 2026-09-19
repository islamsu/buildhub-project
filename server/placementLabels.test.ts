// ── A PLACEMENT IS CALLED THE SAME THING WHEREVER IT APPEARS ───────────────
//
// The commercial placement enums - the package sold, the surface it runs on,
// the kind of entity placed - were printed to the screen exactly as stored.
// An administrator booking a placement chose between SEARCH_RESULTS_BOOST,
// TYPE_CATEGORY_SPOTLIGHT and MASTER_DISCOVERY, and the table below the form
// reported BOOST and PROVIDER.
//
// That is a database column shown to a person as the product's own language,
// and it cannot be translated: the Arabic console showed the same
// SCREAMING_SNAKE_CASE, so the screen was neither English nor Arabic. It was
// found by rendering the console in both languages and comparing the words -
// the tokens came back identical, which is what "never translated" looks like
// from outside.
//
// Two rules here:
//
//   NO RAW ENUM REACHES A SCREEN. Nothing under client/ renders a placement
//   token as visible text.
//
//   THE VOCABULARY COVERS WHAT EXISTS. Every value the server can produce,
//   and every metric the shared module defines, has a reading in both
//   languages - so adding one cannot quietly leave it untranslated.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PLACEMENT_METRIC_FORMULAS } from '../shared/placementAnalytics';
import {
  PLACEMENT_ENTITY_TYPES, PLACEMENT_PACKAGES, PLACEMENT_SURFACES, PLACEMENT_METRICS,
  packageLabel, surfaceLabel, entityTypeLabel, metricLabel, formulaText,
} from '../client/src/lib/placementLabels';

const CLIENT = new URL('../client/src/', import.meta.url);

function clientFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { walk(child, `${prefix}${entry.name}/`); continue; }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
      out.push({ path: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
    }
  };
  walk(CLIENT, '');
  return out;
}

describe('every placement value reads as words, in both languages', () => {
  it('the vocabulary is not empty', () => {
    // POSITIVE CONTROL. Empty tables would satisfy every loop below.
    expect(PLACEMENT_PACKAGES.length).toBeGreaterThan(2);
    expect(PLACEMENT_SURFACES.length).toBeGreaterThan(2);
    expect(PLACEMENT_ENTITY_TYPES.length).toBeGreaterThan(1);
  });

  it('each package, surface and entity type has an English and an Arabic reading', () => {
    const arabic = /[؀-ۿ]/;
    const cases: [string, string[], (v: string, l: 'en' | 'ar') => string][] = [
      ['package', PLACEMENT_PACKAGES, packageLabel],
      ['surface', PLACEMENT_SURFACES, surfaceLabel],
      ['entity type', PLACEMENT_ENTITY_TYPES, entityTypeLabel],
    ];
    for (const [kind, values, label] of cases) {
      for (const value of values) {
        expect(label(value, 'en'), `${kind} ${value} in English`).not.toBe(value);
        expect(label(value, 'ar'), `${kind} ${value} in Arabic`).toMatch(arabic);
      }
    }
  });

  it('an absent value reads as absent, and an unknown one reads as itself', () => {
    // A dash for an unknown surface would say the same thing as no surface at
    // all, and that is the one reading that is certainly wrong.
    expect(surfaceLabel(null, 'en')).toBe('—');
    expect(surfaceLabel('', 'ar')).toBe('—');
    expect(surfaceLabel('FUTURE_SURFACE', 'en')).toBe('FUTURE_SURFACE');
    expect(surfaceLabel('FUTURE_SURFACE', 'ar')).toBe('FUTURE_SURFACE');
  });

  it('every metric the shared module defines has a reading here', () => {
    // The formulas stay in shared/ so the screen and the tests read the same
    // arithmetic. This asserts the readings keep up with them.
    const defined = Object.keys(PLACEMENT_METRIC_FORMULAS);
    expect(defined.length).toBeGreaterThan(2);
    const missing = defined.filter(key => !PLACEMENT_METRICS.includes(key));
    expect(missing, `metrics defined with no reading:\n  ${missing.join('\n  ')}`).toEqual([]);
    for (const key of defined) {
      expect(metricLabel(key, 'ar')).toMatch(/[؀-ۿ]/);
      const english = PLACEMENT_METRIC_FORMULAS[key as keyof typeof PLACEMENT_METRIC_FORMULAS];
      expect(formulaText(key, english, 'en')).toBe(english);
      expect(formulaText(key, english, 'ar')).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('no raw placement token reaches a screen', () => {
  // Tokens that only ever appear as a stored value. The JSX forms are what a
  // person would see: >TOKEN< as element text, or a bare {row.package}.
  const TOKENS = [...PLACEMENT_PACKAGES, ...PLACEMENT_SURFACES, ...PLACEMENT_ENTITY_TYPES];

  it('the sweep can see a rendered token when there is one', () => {
    // POSITIVE CONTROL - this is the exact shape that was there before.
    const sample = '<SelectItem value="BOOST">BOOST</SelectItem>';
    const rendered = TOKENS.filter(token => sample.includes(`>${token}<`));
    expect(rendered).toEqual(['BOOST']);
  });

  it('no client file renders one as visible text', () => {
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      if (file.path === 'lib/placementLabels.ts') continue;
      for (const token of TOKENS) {
        if (file.text.includes(`>${token}<`)) offenders.push(`${file.path}: >${token}<`);
      }
    }
    expect(offenders, `a stored token shown as the product's own words:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });
});
