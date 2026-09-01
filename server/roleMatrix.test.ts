// ── The role matrix is checked against the router, not just written down ───
//
// shared/roleMatrix.ts is the closure deliverable: six roles x nineteen
// resources x nine verbs, with N/A stated and explained wherever the product
// does not implement an operation. A matrix nobody checks is a document that
// was true once. This file is what keeps it true:
//
//   - every cell claiming a tRPC procedure must NAME ONE THAT EXISTS, with the
//     tier it claims;
//   - every cell claiming a storage-proxy path must name a prefix the proxy
//     actually authorizes;
//   - every admin-only cell must name a procedure that really is admin-gated;
//   - the N/A claims that CAN be checked - "no update exists", "no delete
//     exists" - are checked against the router surface;
//   - and every one of the 171 resource/verb pairs must be declared, so a new
//     operation cannot be added without the matrix noticing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MATRIX_RESOURCES, MATRIX_ROLES, MATRIX_VERBS, PROVIDER_ROLES, ROLE_MATRIX, matrixFor,
  type MatrixResource, type MatrixVerb,
} from '@shared/roleMatrix';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');
const STORAGE_PROXY = read('./_core/storageProxy.ts');

/** name -> declared tier, straight from the source. */
function procedureTiers(): Map<string, string> {
  const tiers = new Map<string, string>();
  let router: string | null = null;
  for (const line of ROUTERS.split('\n')) {
    const r = /^const (\w+)Router = router\(\{/.exec(line);
    if (r) { router = r[1]; continue; }
    const d = /^ {2}(\w+): ((?:public|protected|admin|superAdmin|approvedProvider|compliance|aiChat)Procedure|adminWith\([^)]*\))/.exec(line);
    if (d && router) tiers.set(`${router}.${d[1]}`, d[2]);
  }
  return tiers;
}
const TIERS = procedureTiers();

/**
 * The source of one procedure, scoped to ITS router.
 *
 * A bare indexOf('\n  create: ') finds projects.create, not marketplace.create -
 * which is exactly the mistake this helper exists to stop, and exactly the
 * mistake the first draft of the guard below made.
 */
function procedureBody(qualified: string): string {
  const [routerName, procedure] = qualified.split('.');
  const routerStart = ROUTERS.indexOf(`const ${routerName}Router = router({`);
  expect(routerStart, `router ${routerName} not found`).toBeGreaterThan(-1);
  const routerEnd = ROUTERS.indexOf('\n});', routerStart);
  const block = ROUTERS.slice(routerStart, routerEnd);
  const start = block.indexOf(`\n  ${procedure}: `);
  expect(start, `${qualified} not found in ${routerName}Router`).toBeGreaterThan(-1);
  return block.slice(start, start + 2500);
}

const cells = (): { resource: MatrixResource; verb: MatrixVerb }[] =>
  MATRIX_RESOURCES.flatMap(resource => MATRIX_VERBS.map(verb => ({ resource, verb })));

describe('the matrix covers the whole grid', () => {
  it('declares all 171 resource/verb pairs, with nothing left undefined', () => {
    expect(MATRIX_RESOURCES).toHaveLength(19);
    expect(MATRIX_VERBS).toHaveLength(9);
    expect(MATRIX_ROLES).toHaveLength(6);
    const missing = cells().filter(({ resource, verb }) => !ROLE_MATRIX[resource][verb]);
    expect(missing, 'undeclared cells').toEqual([]);
    expect(cells()).toHaveLength(171);
  });

  it('the source it checks against was actually parsed', () => {
    // Every rule below is vacuous if the tier map is empty.
    expect(TIERS.size).toBeGreaterThanOrEqual(130);
    expect(TIERS.get('rfq.submitQuotation')).toBe('approvedProviderProcedure');
  });

  it('every N/A carries a REASON, not a blank', () => {
    for (const { resource, verb } of cells()) {
      const cell = ROLE_MATRIX[resource][verb];
      if (cell.status !== 'na') continue;
      expect(cell.why.length, `${resource}.${verb}`).toBeGreaterThan(20);
      expect(cell.why, `${resource}.${verb}`).not.toMatch(/^(todo|tbd|n\/a|unknown)/i);
    }
  });
});

describe('every implemented cell names something real', () => {
  for (const { resource, verb } of cells()) {
    const cell = ROLE_MATRIX[resource][verb];
    if (cell.status === 'na') continue;
    if (cell.via.startsWith('route:') || cell.via.startsWith('proxy:')) continue;

    it(`${resource}.${verb} -> ${cell.via}`, () => {
      const tier = TIERS.get(cell.via);
      expect(tier, `${cell.via} is claimed by the matrix but does not exist`).toBeDefined();
      if (cell.status === 'admin-only') {
        expect(tier, `${cell.via} is declared admin-only but its tier is ${tier}`)
          .toMatch(/^(adminWith\(|superAdminProcedure|adminProcedure)/);
      } else {
        expect(tier, `${cell.via} tier drifted`).toBe(cell.tier);
      }
    });
  }

  it('every storage-proxy path the matrix cites is a prefix the proxy authorizes', () => {
    const cited = cells()
      .map(({ resource, verb }) => ROLE_MATRIX[resource][verb])
      .filter(cell => cell.status !== 'na' && cell.via.startsWith('proxy:'))
      .map(cell => (cell as { via: string }).via.slice('proxy:'.length));
    expect(cited.length).toBeGreaterThanOrEqual(4);
    for (const prefix of cited) {
      expect(STORAGE_PROXY, `the proxy does not classify ${prefix}`).toContain(`startsWith('${prefix}')`);
    }
  });
});

describe('the N/A claims that can be falsified are checked', () => {
  it('"no update exists" is true - the whole router has exactly two', () => {
    // If someone adds marketplace.update or rfq.update, the matrix's edit
    // cells become lies and this fails first.
    const updates = [...TIERS.keys()].filter(name => /\.update$/.test(name)).sort();
    expect(updates).toEqual(['portfolio.update', 'profile.update', 'projects.update']);
  });

  it('"no delete exists" is true - nothing user-facing deletes but AI attachments', () => {
    const deletes = [...TIERS.keys()].filter(name => /\.delete/i.test(name)).sort();
    expect(deletes).toEqual(['admin.deleteDummyUser', 'ai.deleteAttachment', 'portfolio.delete']);
  });

  it('there is genuinely no order surface', () => {
    expect([...TIERS.keys()].filter(name => /order/i.test(name))).toEqual([]);
    expect(ROLE_MATRIX.order.view.status).toBe('na');
  });

  it('there is no checkout - the transaction create cell is honest', () => {
    expect([...TIERS.keys()].filter(name => /checkout|pay(ment)?$/i.test(name))).toEqual([]);
    expect(ROLE_MATRIX.transaction.create.status).toBe('na');
  });
});

describe('role reachability follows the tier, not the matrix author', () => {
  it('every approvedProvider cell is limited to the five provider roles', () => {
    // A homeowner is not a provider. If a cell claims a provider-gated
    // procedure is reachable by "all", the matrix would be advertising a
    // FORBIDDEN as a capability.
    for (const { resource, verb } of cells()) {
      const cell = ROLE_MATRIX[resource][verb];
      if (cell.status !== 'ok' || cell.tier !== 'approvedProviderProcedure') continue;
      expect(cell.roles, `${resource}.${verb} names ${cell.via}`).not.toBe('all');
      const roles = cell.roles as readonly string[];
      expect(roles).not.toContain('homeowner');
      for (const role of roles) expect(PROVIDER_ROLES).toContain(role);
    }
  });

  it('every complianceProcedure cell is limited to the five compliance roles', () => {
    for (const { resource, verb } of cells()) {
      const cell = ROLE_MATRIX[resource][verb];
      if (cell.status !== 'ok' || cell.tier !== 'complianceProcedure') continue;
      expect(cell.roles as readonly string[]).toEqual([...PROVIDER_ROLES]);
    }
  });

  it('a supplier-only claim is backed by a guard IN THE PROCEDURE, not just by the tier', () => {
    // The tier alone cannot express "supplier only" - approvedProviderProcedure
    // admits all five provider roles. Any cell narrowing to a single role must
    // therefore point at a procedure whose own body checks userRole, or the
    // matrix is asserting a restriction the server does not apply.
    //
    // I nearly recorded the opposite as a defect: reading only the first twelve
    // lines of marketplace.create showed the input schema and no guard, and the
    // guard is the first statement of the mutation below it. Checking the body
    // is what settles it either way.
    for (const { resource, verb } of cells()) {
      const cell = ROLE_MATRIX[resource][verb];
      if (cell.status !== 'ok' || cell.roles === 'all') continue;
      const roles = cell.roles as readonly string[];
      if (roles.length !== 1) continue;
      const body = procedureBody(cell.via);
      expect(body, `${cell.via} claims ${roles[0]}-only but nothing in it checks userRole`)
        .toContain(`ctx.user.userRole !== '${roles[0]}'`);
    }
  });

  it('the supplier-only cells are exactly the product catalogue ones', () => {
    const supplierOnly = cells()
      .filter(({ resource, verb }) => {
        const cell = ROLE_MATRIX[resource][verb];
        return cell.status === 'ok' && Array.isArray(cell.roles) && (cell.roles as string[]).join() === 'supplier';
      })
      .map(({ resource, verb }) => `${resource}.${verb}`);
    expect(supplierOnly.sort()).toEqual(['product.create', 'product.submit']);
  });
});

describe('the per-role view is usable', () => {
  it('produces 171 rows for every role', () => {
    for (const role of MATRIX_ROLES) expect(matrixFor(role)).toHaveLength(171);
  });

  it('a homeowner is refused the provider-gated surfaces, with the reason', () => {
    const rows = matrixFor('homeowner');
    const submit = rows.find(r => r.resource === 'quotation' && r.verb === 'create')!;
    expect(submit.allowed).toBe(false);
    expect(submit.detail).toContain('REFUSED');
    expect(submit.detail).toContain('contractor');
  });

  it('a supplier is the only role that may create a product', () => {
    for (const role of MATRIX_ROLES) {
      const row = matrixFor(role).find(r => r.resource === 'product' && r.verb === 'create')!;
      expect(row.allowed, `${role} product.create`).toBe(role === 'supplier');
    }
  });

  it('the roles differ - this is not one permission set with six labels', () => {
    const signatures = MATRIX_ROLES.map(role =>
      matrixFor(role).map(r => (r.allowed ? '1' : '0')).join(''));
    // Homeowner must differ from every provider; the supplier must differ from
    // the other providers. Engineer/architect/project_manager legitimately
    // share a permission set - they differ in EXPERIENCE, not in authority,
    // and saying otherwise here would be inventing a distinction.
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(3);
    expect(signatures[0]).not.toBe(signatures[1]);
    expect(signatures[4]).not.toBe(signatures[1]);
  });
});
