# BuildHub release acceptance — status, not a merge request

**RC HEAD** `a3ceca6` · base `origin/main` `1b3edb8` · 88 commits · 403 files
· 7 migrations in the RC (0054–0060) · 4730 tests

This is a STATUS document. It is deliberately **not** the merge request in
`CLAUDE.md` §43, because §42 and §78 are not both satisfied yet and §89 says
not to ask until the release is coherent across the whole product.

---

## Delivery state, in §2's vocabulary

| State | Reached? |
|---|---|
| IMPLEMENTED | yes |
| COMMITTED | yes |
| PUSHED | yes — `a3ceca6`, local == remote, tree clean |
| IN RELEASE CANDIDATE | yes |
| MERGED | **no** — needs owner authorization |
| DEPLOYED | **no** |
| STAGING VERIFIED | **no** |
| OWNER DELIVERED | **no** |

Migrations **0056, 0057, 0058, 0059, 0060** are **PUSHED — applied locally,
not yet staging-verified**.

---

## Why staging verification has not happened

`render.yaml` records `branch: claude/buildhub-global-release-candidate`, which
is the owner-approved source. Per §89 that is **configuration, not proof**.

Verification needs `/version` to report `a3ceca6` with
`environment: "staging"`. From this container that request cannot be made:
the environment's network policy denies `buildhub-staging.onrender.com`, and
the gateway answers 403 to CONNECT.

**What unblocks it:** raising Network access for this environment, or adding
that host to the allowed domains, in the cloud environment's settings. With
that, `scripts/verify-staging.mjs` runs the pinned check.

Two things remain true regardless:

- an existing Render service may still need a Blueprint sync before it tracks
  the new branch — a `render.yaml` commit does not retarget a service that was
  provisioned earlier;
- nothing may be called DEPLOYED, STAGING PREVIEW VERIFIED or STAGING VERIFIED
  until that exact SHA is observed serving, with the migration-dependent
  journeys exercised against it.

---

## §42 release gate — what is green

- P0 known defects: **0**
- P1 known defects: **0**
- full test suite: **4730 passing**
- typecheck: clean
- production build: clean
- working tree clean, local SHA == remote SHA
- security negatives: green (cross-tenant, IDOR and authorization probes)
- supplier commercial arc, professional role arcs, Admin operational arcs
- current-release marketplace capabilities (North Star 15–20)
- mobile / RTL / accessibility across 22 routes × 2 widths × 2 languages
  (434 checks, twice, identical verdicts)
- truthful failure and empty states, including a real database outage

## §42 release gate — what is NOT yet green

These are open, and none of them has evidence in the repository today:

| Gate | Status |
|---|---|
| Performance reviewed (§35, §63) | **OPEN** — no performance test or probe exists |
| Reliability reviewed (§35, §64) | **OPEN** — partially covered by outage/idempotency probes, no dedicated review |
| SEO complete (§37, §66) | **GREEN** — `server/seo.test.ts` (57) and `evidence/zg-seo.mjs` (89, twice, identical), five mutations verified. One finding referred to the owner: `/vendor/:id` needs a session |
| AI release gate (§38) | **PARTIAL** — AI tests exist; the §38 gate itself is not recorded as run |
| ACC-4 fresh-account cross-role acceptance | **OPEN** — no ACC-4 probe exists |
| Upload master pass (§34) | **PARTIAL** — `uploadfamilies` probe exists; real S3 round-trip remains infrastructure-blocked |
| Tracker reconciled (§41) | **PARTIAL** — 27 items still open in `todo.md`, mixing engineering with owner decisions and future architecture |

**Therefore merge authorization is not requested.** Asking now would be asking
the owner to accept a release whose own gate lists seven unmet criteria.

---

## Infrastructure-blocked, not incomplete

- Object storage: no S3 credentials, so a real upload round-trip is an honest
  SKIP rather than a pass.
- Staging observation: network policy, as above.

## Owner decisions still open

- Protect `main` with a GitHub ruleset (governance authorization).
- `projects.spent` vs the live expense-log sum — recorded as settled in
  `OWNER_DECISIONS.md`; the tracker entry is a duplicate to retire.
- Team / Organization architecture: post-release.
- Payment gateway: owner-deferred, and every "no budget / no CPC / no revenue"
  guarantee in the Marketing Center depends on it staying deferred.
