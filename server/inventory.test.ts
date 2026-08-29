/**
 * ── The inventory has to stay true ──────────────────────────────────────────
 *
 * docs/inventory.json is generated from the source. A generated file nobody
 * checks is worse than no file: it looks authoritative and quietly describes a
 * repository that stopped existing months ago. These tests do two jobs.
 *
 * 1. STALENESS. Derive the inventory fresh and compare it with the committed
 *    copy. Note that this imports buildInventory() rather than running the
 *    script - running it would rewrite the file and then "verify" what it had
 *    just written, which tests nothing.
 *
 * 2. THE INVARIANT. A route that declares a :param whose component never reads
 *    one is a defect, not a style question. /marketplace/vendors/:id,
 *    /marketplace/designers/:id and /marketplace/finishing/:id each rendered
 *    their whole directory and dropped the id, so a link naming one provider
 *    delivered a page listing every provider. The marketplace hub's vendor
 *    search suggestion pointed at exactly that route while the designer and
 *    finishing suggestions beside it used the canonical /vendor/:id - so
 *    picking a vendor from search took you to the directory you were trying to
 *    escape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs tool script, no types, deliberately not compiled
import { buildInventory } from '../scripts/inventory.mjs';

const ROOT = join(__dirname, '..');
const committed = JSON.parse(readFileSync(join(ROOT, 'docs/inventory.json'), 'utf8'));
const fresh = buildInventory() as typeof committed;

describe('the generated inventory', () => {
  it('is not stale - the committed copy matches a fresh derivation', () => {
    // If this fails: run `node scripts/inventory.mjs` and commit the result.
    expect(fresh).toEqual(committed);
  });

  it('found the application, not an empty repository', () => {
    // A parser that silently stops matching would otherwise make every
    // assertion below vacuously true against zero rows.
    expect(fresh.routes.length).toBeGreaterThan(25);
    expect(fresh.procedures.length).toBeGreaterThan(80);
    expect(fresh.tables.length).toBeGreaterThan(25);
    expect(fresh.notificationWrites.length).toBeGreaterThan(0);
  });
});

describe('no route declares a parameter it ignores', () => {
  it('has zero dead param routes', () => {
    const dead = fresh.routes
      .filter((r: { deadParamRoute: boolean }) => r.deadParamRoute)
      .map((r: { path: string; component: string }) => `${r.path} -> ${r.component}`);
    expect(dead).toEqual([]);
  });

  it('every route that declares :param resolves a component source it can read', () => {
    // Guards the invariant above from passing for the wrong reason: if the
    // component could not be located at all, readsParam is false and the route
    // would be reported dead - or, worse, a future change to the fallback could
    // make an unreadable component look alive.
    for (const r of fresh.routes) {
      if (!r.declaresParam) continue;
      expect(r.readsParam, `${r.path} (${r.component}) reads no route param`).toBe(true);
    }
  });
});

describe('the provider detail route is canonical', () => {
  const paths = () => fresh.routes.map((r: { path: string }) => r.path);

  it('/vendor/:id exists and is the provider detail page', () => {
    const vendor = fresh.routes.find((r: { path: string }) => r.path === '/vendor/:id');
    expect(vendor?.component).toBe('VendorProfile');
  });

  it('the three legacy per-directory detail URLs redirect rather than render a list', () => {
    for (const path of [
      '/marketplace/vendors/:id',
      '/marketplace/designers/:id',
      '/marketplace/finishing/:id',
    ]) {
      const route = fresh.routes.find((r: { path: string }) => r.path === path);
      expect(route, `${path} is missing - existing links to it would 404`).toBeDefined();
      expect(route.component, `${path} must not render a directory`).toBe('RedirectToVendor');
    }
    expect(paths()).toContain('/marketplace/vendors');
  });

  it('no page links a provider at a directory URL', () => {
    // The actual defect, asserted at its source rather than through the route
    // table: a link to one provider must not be built from a directory path.
    // Restricted to the /<id> shape so the directory links themselves pass.
    const pages = ['MarketplaceHub', 'VendorsDirectory', 'DesignersDirectory', 'FinishingDirectory'];
    for (const page of pages) {
      const src = readFileSync(join(ROOT, `client/src/pages/${page}.tsx`), 'utf8');
      const offenders = [...src.matchAll(/`\/marketplace\/(?:vendors|designers|finishing)\/\$\{[^}]+\}`/g)]
        .map(m => m[0]);
      expect(offenders, `${page}.tsx links a provider at a directory URL`).toEqual([]);
    }
  });
});

describe('notifications go through the localisation helper', () => {
  it('no site outside the helper writes the notifications table directly', () => {
    // A raw insert skips messageKey/messageParams, which is what the bilingual
    // renderer reads - in a half-Arabic product that means a notification
    // nobody can read. The two inserts inside server/notifications.ts are
    // notifyUser and notifyUsers themselves and are the point of the rule.
    const raw = fresh.notificationWrites
      .filter((n: { via: string }) => n.via === 'RAW INSERT - bypasses localisation')
      .map((n: { file: string; line: number }) => `${n.file}:${n.line}`);
    expect(raw).toEqual([]);
  });

  it('the helper seam is exactly two functions, not a growing set of writers', () => {
    // If this count moves, someone added a third way to write the table and the
    // exemption above silently widened to cover it.
    const seam = fresh.notificationWrites
      .filter((n: { via: string }) => n.via === 'helper implementation');
    expect(seam).toHaveLength(2);
    for (const s of seam) expect(s.file).toBe('server/notifications.ts');
  });
});
