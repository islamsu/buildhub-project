# BuildHub release acceptance — status, not a merge request

**RC HEAD** `9ab4783` · base `origin/main` `1b3edb8` · 90 commits
· 7 migrations in the RC (0054–0060) · 4826 tests

This is a STATUS document. It is deliberately **not** the merge request in
`CLAUDE.md` §43, because §42 and §78 are not both satisfied yet and §89 says
not to ask until the release is coherent across the whole product.

---

## Delivery state, in §2's vocabulary

| State | Reached? |
|---|---|
| IMPLEMENTED | yes |
| COMMITTED | yes |
| PUSHED | yes — local == remote, tree clean |
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

Verification needs `/version` to report the current RC SHA with
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
- full test suite: **4826 passing**
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
| Performance reviewed (§35, §63) | **GREEN** — `evidence/zg-performance.mjs` (29, twice, identical). Query count measured against result size, so an N+1 fails without a threshold; page-size caps, payload ceiling and the indexes behind every hot filter. Lab wall times recorded, not gated — §63's field data needs production telemetry |
| Reliability reviewed (§35, §64) | **GREEN** — `evidence/zg-reliability.mjs` (20, twice, identical) plus the existing outage, flood and allowance-race probes. Found and fixed two dead duplicate-key guards |
| SEO complete (§37, §66) | **GREEN** — `server/seo.test.ts` (57) and `evidence/zg-seo.mjs` (89, twice, identical), five mutations verified. One finding referred to the owner: `/vendor/:id` needs a session |
| AI release gate (§38) | **GREEN, with one item infrastructure-blocked** — `server/aiReleaseGate.test.ts` (14) maps each §38 item to the guarantee that proves it, over the 160 existing AI assertions; `evidence/zg-ai.mjs` (20, twice, identical) renders the unavailable state in EN and AR at 1440 and 375. No `OPENAI_API_KEY` here, so whether a live model obeys a correct instruction is not verified |
| ACC-4 fresh-account cross-role acceptance | **GREEN** — `evidence/zg-acc4.mjs` (116, twice, identical): six roles created through the real sign-up, each landing where the app sends them, EN and AR |
| Upload master pass (§34) | **PARTIAL** — `uploadfamilies` probe exists; real S3 round-trip remains infrastructure-blocked |
| Tracker reconciled (§41) | **PARTIAL** — 27 items still open in `todo.md`, mixing engineering with owner decisions and future architecture |

**Therefore merge authorization is not requested.** Asking now would be asking
the owner to accept a release whose own gate lists seven unmet criteria.

---

## Infrastructure-blocked, not incomplete

- Object storage: no S3 credentials, so a real upload round-trip is an honest
  SKIP rather than a pass.
- Staging observation: network policy, as above.
- AI: no `OPENAI_API_KEY`, so every §38 item is verified at the layer that
  decides it — the system prompt, the context builders, the authorization
  checks — and no live answer was obtained. `evidence/zg-ai.mjs` turns the
  absence into evidence for the item it can prove: an assistant with no engine
  says so, disables its composer, fabricates nothing, and the endpoint refuses
  with a sentence that names no credential.

## A decision this pass tried to change, and should not have

The §38 gate was first written to make the assistant answer in the language of
the QUESTION, which is how §38 words it. `server/languageAuthority.test.ts`
failed immediately, and its reasoning is better than the reading that replaced
it: the person reading the answer is on an Arabic page, having chosen Arabic;
somebody who types one English technical term has not changed languages, and an
answer that follows the question strands them with a reply their page cannot lay
out correctly. All four site/question combinations were already covered there.

The change was reverted and the gate now asserts the rule that exists. Recorded
here because the near-miss is the useful part: a settled decision was protected
by its own test, which is what that test was for.

## Findings referred to the owner

**The provider storefront is not public.** `/vendor/:id` requires a session —
`profile.getPublic` is a `protectedProcedure`, and the code there records
logged-out access as an unresolved decision from Phase 4A.5. §21 and §37 both
describe that page as public and crawlable. Proven in a browser: a signed-out
reader gets "Please sign in".

It is therefore marked `session-required` in `shared/seo.ts`: real metadata for
a signed-in reader, never indexable, never in the sitemap, and the sitemap
states how many storefronts are withheld so the omission is visible rather
than looking like a marketplace with no suppliers. One word changes all of it
when the decision is made.

**Service price ranges have no currency to read.** `serviceOfferings` carries
`priceMin` and `priceMax` and no currency column. Both screens now render
through the canonical formatter with the market's currency named by
`requireCurrencyForMarket(DEFAULT_MARKET)`, so the coupling is one greppable
expression; the remaining debt is the column, and it is declared in
`server/marketReadiness.test.ts`.

**Category pages have no URL of their own.** A category is a `?cat=` filter, so
it canonicalises to its parent listing and is not separately indexable. Correct
for a filter; a real sourcing destination per category is a NEXT MARKETPLACE
MILESTONE item, not a defect to fix inside this RC.

## Owner decisions still open

- Protect `main` with a GitHub ruleset (governance authorization).
- `projects.spent` vs the live expense-log sum — recorded as settled in
  `OWNER_DECISIONS.md`; the tracker entry is a duplicate to retire.
- Team / Organization architecture: post-release.
- Payment gateway: owner-deferred, and every "no budget / no CPC / no revenue"
  guarantee in the Marketing Center depends on it staying deferred.
