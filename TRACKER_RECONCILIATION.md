# Tracker reconciliation — §41

`CLAUDE.md` §41 says the tracker must not mix current engineering with
duplicates, owner decisions, infrastructure blocks, future architecture and the
next commercial milestone, and that every remaining item must be classified into
one of its categories. It also says: **never delete work merely to improve
completion numbers.**

So nothing below is removed from `todo.md`. That file stays as the historical
ledger; this one says what each of its **27 open items** actually is, and
`server/trackerReconciliation.test.ts` fails if an open item is not listed here
or carries no category.

The categories are §41's own words:

`CURRENT RELEASE ENGINEERING` · `ALREADY COMPLETE` · `DUPLICATE` ·
`OWNER DECISION` · `INFRASTRUCTURE BLOCKED` · `OWNER DEFERRED` ·
`POST-RELEASE ARCHITECTURE` · `NEXT MARKETPLACE MILESTONE` · `NOT APPLICABLE`

---

## ALREADY COMPLETE — with the evidence

These are done. They are left unchecked in `todo.md` only because nobody went
back to tick them; the evidence is named so that is now checkable rather than
asserted.

| todo.md item | Category | Evidence |
|---|---|---|
| AI knowledge completeness separated from AI engine capability; no fabricated primary-source authority | ALREADY COMPLETE | `server/aiReleaseGate.test.ts` (14), `evidence/zg-ai.mjs` (20 ×2), over `aiFalsePremises` (17) and `aiUnavailableAffordance` (7) |
| Performance/reliability review: unbounded queries, N+1, pagination, indexes, image payloads, debounce, double-submit/idempotency | ALREADY COMPLETE | `evidence/zg-performance.mjs` (29 ×2) and `evidence/zg-reliability.mjs` (20 ×2). The N+1 check measures query count against result size, so it fails without a threshold |
| Public SEO/discovery for crawlable marketplace content while keeping private RFQs/projects/messages/admin non-indexed | ALREADY COMPLETE | `server/seo.test.ts` (57), `evidence/zg-seo.mjs` (89 ×2). Private-by-default route table; production-only indexability |
| Accessibility/mobile/RTL evidence separated into responsive implementation vs VISUAL QA | ALREADY COMPLETE | `evidence/zg-visualqa.mjs` (434 ×2): 22 routes × 2 widths × 2 languages plus six state classes |
| Broader role self-service second pass (Contractor/Engineer/PM dashboards) | ALREADY COMPLETE | `evidence/zg-professional-arcs.mjs` (21), `evidence/zg-acc4.mjs` (116 ×2) — every role exercised from a fresh account |
| Homeowner self-service second pass: profile, projects, members, documents, RFQ basket, RFQs, attachments, invitations, quotations, comparison, accept/reject, messages, notifications | ALREADY COMPLETE | `evidence/zg-journey-homeowner.mjs` (24), `evidence/zg-projectteam.mjs` (30), `evidence/zg-savedtorfq.mjs` (28) |
| Project Manager self-service second pass: authorized creation/management, members, documents, RFQs, invitations, commercial authority by capability, messages, notifications, settings | ALREADY COMPLETE | `evidence/zg-projectcapability.mjs`, `evidence/zg-projectteam.mjs` (30), `evidence/zg-professional-arcs.mjs` (21) |
| Contractor/Engineer/Architect/Designer/other-provider self-service parity with shared provider architecture | ALREADY COMPLETE | `evidence/zg-professional-arcs.mjs` (21) and `server/aiRoles.test.ts` — parity is tested per role, not assumed from a shared component |
| Compliance self-service and Admin queue completeness, provider never self-verifies | ALREADY COMPLETE | `evidence/zg-acc4.mjs` renders the fresh-professional compliance screen in both languages; `evidence/zg-admincensus.mjs` and `evidence/zg-attention.mjs` cover the Admin queue |
| Admin Notes: internal-only, permission-controlled, authored/timestamped, never public | ALREADY COMPLETE | `admin.userNotes` / `admin.addUserNote` behind `users.read` / `users.manage`; `evidence/zg-user360.mjs` (39) |
| Onboarding reconciliation for providers and homeowners without unnecessary blocking | ALREADY COMPLETE | `evidence/zg-acc4.mjs` (116 ×2): a fresh buyer reaches their workspace immediately, a fresh professional reaches compliance with every required document named |

## DUPLICATE — points at the canonical item

Four entries restate an item already above. §41 asks for duplicates to be named
rather than counted twice.

| todo.md item | Canonical item |
|---|---|
| AI accuracy/security and knowledge-source completeness; distinguish engine capability from source completeness | the AI knowledge/capability item above |
| Public marketplace SEO where framework supports it without exposing private data | the public SEO/discovery item above |
| Performance review: unbounded queries, N+1, pagination, indexes, payloads, debounce, Featured query efficiency | the performance/reliability review item above |
| Reliability review: double-submit, idempotency, race-sensitive flows, state transitions, retry/timeouts | the performance/reliability review item above |

## OWNER DECISION — settled, and recorded as settled

`CLAUDE.md` §39 lists these as standing decisions and says not to stop on them
again. They stay in the tracker as the record of the decision.

| todo.md item | Where it is settled |
|---|---|
| `projects.spent` vs live expense-log sum — retain as OWNER DECISION unless resolved | §15 and `OWNER_DECISIONS.md`: the expense log is canonical |
| Supplier answer editing/moderation policy — retain as OWNER DECISION unless already resolved | §14: resolved by the Product Q&A decision, and built |
| Messaging prior-relationship policy — retain OWNER DECISION unless later resolved | §16: open marketplace contact, bounded by volume and breadth controls |
| Historical owner decisions: project.spent vs expense log, renovation/finishing preset, mandatory product fields, provider comparison surface, RFQ budget exposure, messaging relationship | §39 — the same list, already answered |

## OWNER DEFERRED

| todo.md item | Status |
|---|---|
| Payment gateway remains OWNER-DEFERRED; no live payments, orders, transactions, revenue, GMV, commissions, or cash rewards | §39. Every "no budget / no CPC / no revenue" guarantee in the Marketing Center depends on this staying deferred |

## POST-RELEASE ARCHITECTURE

| todo.md item | Status |
|---|---|
| Team / organization management (future architectural milestone, not yet modeled) | §39: post-release |
| Team / Organization management: concrete company role model and authorization plan if architecture requires redesign | §39: post-release. The same milestone, stated as a plan |
| Admin impersonation: classify SECURITY ARCHITECTURE REQUIRED unless a safe time-limited, audited, banner-protected mechanism exists | §39: do not launch. Future security architecture |

## INFRASTRUCTURE BLOCKED

Not incomplete. Each needs something this environment does not have, and the
blocker is named rather than implied.

| todo.md item | Blocker |
|---|---|
| Linux CI observation + staging/infrastructure verification | The environment's network policy denies `buildhub-staging.onrender.com`; the gateway answers 403 to CONNECT. See `RELEASE_ACCEPTANCE.md` |
| Re-run `staging-qa.yml` against the deployed SHA with the corrected gate and confirm | Same blocker: `/version` cannot be read from this container, and a pass against an unknown build is worse than no pass |
| Upload master pass for all applicable upload families with validation, storage, parent relationship, retrieval, replace/delete, authorization, IDOR protection | PARTIAL. `evidence/zg-uploadfamilies.mjs` (11) covers the writers, ownership and IDOR guards; a real S3 round-trip needs object-storage credentials that do not exist here |

## NEXT MARKETPLACE MILESTONE

| todo.md item | Why not this release |
|---|---|
| Full Vendor Management command centre with real applicable modules and cross-links from Admin surfaces | The modules exist and are reachable — User 360 (`zg-user360`, 39), Vendor Enquiries, placements, referrals, compliance — and `evidence/zg-admincensus.mjs` proves each is discoverable. A single unified vendor console on top of them is a consolidation, not a missing capability, and §20 says not to delay the release for it |

---

## Two findings this reconciliation also records

Neither is a `todo.md` line; both came out of closing the gates above and belong
somewhere a reader will find them.

- **The provider storefront needs a session.** `/vendor/:id` is not public,
  while §21 and §37 describe it as public and crawlable. Referred to the owner
  in `RELEASE_ACCEPTANCE.md`; `shared/seo.ts` marks it `session-required` so
  nothing advertises it in the meantime.
- **`serviceOfferings` has no currency column.** The two service price surfaces
  now name the market's currency through `requireCurrencyForMarket`, so the
  remaining debt is the column. Declared in `server/marketReadiness.test.ts`.
