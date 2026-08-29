import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AN ICON-ONLY CONTROL NEEDS A NAME.
 *
 * A live accessibility sweep of ten pages at 375, 768 and 1440 found the AI
 * composer's send button with no accessible name at all: its only content is
 * an svg, so a screen reader announced "button" and nothing else - on the
 * control that sends the message.
 *
 * This scans the shipping source for the same shape: a Button whose children
 * are icons alone and which carries no aria-label, no title and no
 * aria-labelledby.
 */

const CLIENT = new URL('../client/src/', import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(p));
    else if (entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** `<Button ...>` through its closing tag, non-greedy, one per match. */
function buttonBlocks(source: string): { open: string; body: string }[] {
  const out: { open: string; body: string }[] = [];
  const re = /<Button\b([^>]*)>([\s\S]*?)<\/Button>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ open: m[1], body: m[2] });
  return out;
}

const ICON_ONLY = /^(?:\s|\{|\}|\?|:|\(|\)|&&|\|\||true|false|null|<\/?>)*(?:<[A-Z]\w*\s[^>]*\/>|<[A-Z]\w*\s*\/>)(?:\s|\{|\}|\?|:|\(|\)|&&|\|\||true|false|null|<\/?>)*$/;

describe('every icon-only button announces what it does', () => {
  const files = tsxFiles(CLIENT).filter(f => !f.includes('/components/ui/') && !f.endsWith('ComponentShowcase.tsx'));

  it('finds buttons to police, so the scan is not vacuous', () => {
    const total = files.reduce((n, f) => n + buttonBlocks(readFileSync(f, 'utf8')).length, 0);
    expect(total, 'no <Button> elements found - the scanner is broken').toBeGreaterThan(40);
  });

  it('none of them is an unnamed icon', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { open, body } of buttonBlocks(readFileSync(file, 'utf8'))) {
        if (!ICON_ONLY.test(body.trim())) continue;                 // has text
        if (/aria-label|aria-labelledby|title=/.test(open)) continue; // named
        if (/asChild/.test(open)) continue;                          // the child carries the name
        offenders.push(`${file.replace(CLIENT, '')}: <Button${open.slice(0, 60)}> ${body.trim().slice(0, 40)}`);
      }
    }
    expect(offenders, `icon-only buttons with no accessible name:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the AI send button in particular is named in both languages', () => {
    const chat = readFileSync(join(CLIENT, 'components/AIChatBox.tsx'), 'utf8');
    expect(chat).toContain("aria-label={isLoading ? t('ai.send.sending') : t('ai.send')}");
    // and its icons are hidden from the accessibility tree, so the name is the
    // only thing announced rather than being read alongside the glyph.
    expect(chat).toMatch(/<Loader2[^>]*aria-hidden/);
    expect(chat).toMatch(/<Send[^>]*aria-hidden/);
    const i18n = readFileSync(join(CLIENT, 'contexts/LanguageContext.tsx'), 'utf8');
    for (const key of ['ai.send', 'ai.send.sending']) {
      expect(i18n.split(`'${key}':`).length - 1, `${key} must exist in EN and AR`).toBe(2);
    }
  });
});

describe('every page has a top-level heading', () => {
  it('the homeowner dashboard has one', () => {
    // It had an h2 and no h1 anywhere in the document, so assistive technology
    // had no top-level heading to land on.
    const page = readFileSync(join(CLIENT, 'pages/HomeownerDashboard.tsx'), 'utf8');
    expect(page).toMatch(/<h1[^>]*>[\s\S]*?<\/h1>/);
  });

  it.each([
    ['RFQDetail', 'pages/RFQDetail.tsx'],
    ['ProductDetail', 'pages/ProductDetail.tsx'],
    ['VendorProfile', 'pages/VendorProfile.tsx'],
    ['AIAssistantPage', 'pages/AIAssistantPage.tsx'],
  ])('%s has one', (_n, rel) => {
    expect(readFileSync(join(CLIENT, rel), 'utf8')).toMatch(/<h1[^>]*>/);
  });
});
