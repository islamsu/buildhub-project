# BuildHub release acceptance — status, not a merge request

**RC HEAD** the tip of `claude/buildhub-global-release-candidate` · base
`origin/main` `1b3edb8` · 8 migrations in the RC (0054–0062) · 5018 tests

**The tip is the SHA for staging acceptance**, and it is named here as the tip
rather than written out: a document cannot state the SHA of the commit that
contains it. Read it with

```
git rev-parse origin/claude/buildhub-global-release-candidate
```

and `/version` must report that exact commit with `environment: "staging"` before
anything beyond PUSHED is claimed.

The tip now carries a code change again: the owner-found project-card defect
recorded below was fixed after the earlier acceptance pass, so the SHA for
staging acceptance is the tip as read by the command above, not any SHA named
in an earlier report. No pull request is open, and none will be until staging is
verified.

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

Migrations **0056, 0057, 0058, 0059, 0060, 0061** are **PUSHED — applied
locally, not yet staging-verified**. `0061` was additionally verified two ways
that matter for a backfill: every migration applied to an EMPTY database (64
tables, the column present), and `0061` applied ALONE to a table already holding
rows, where both legacy offerings read `EGP` and none read null.

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
- full test suite: **4887 passing**
- typecheck: clean
- production build: clean
- working tree clean, local SHA == remote SHA
- security negatives: green (cross-tenant, IDOR and authorization probes)
- supplier commercial arc, professional role arcs, Admin operational arcs
- current-release marketplace capabilities (North Star 15–20)
- mobile / RTL / accessibility across 22 routes × 2 widths × 2 languages
  (434 checks, twice, identical verdicts)
- truthful failure and empty states, including a real database outage

## §42 release gate — every criterion it lists is now green

The seven that were open have been closed, each with evidence recorded in the
repository and each mutation-tested so a green check cannot pass vacuously:

| Gate | Evidence |
|---|---|
| Performance reviewed (§35, §63) | `evidence/zg-performance.mjs` 29 ×2 |
| Reliability reviewed (§35, §64) | `evidence/zg-reliability.mjs` 20 ×2 |
| SEO complete (§37, §66) | `server/seo.test.ts` 57 · `evidence/zg-seo.mjs` 89 ×2 |
| AI release gate (§38) | `server/aiReleaseGate.test.ts` 14 · `evidence/zg-ai.mjs` 20 ×2 |
| ACC-4 fresh-account cross-role | `evidence/zg-acc4.mjs` 116 ×2 |
| Tracker reconciled (§41) | `TRACKER_RECONCILIATION.md` · `server/trackerReconciliation.test.ts` 7 |
| Money presentation (§86–88) | `server/moneyPresentation.test.ts` 21 · `evidence/zg-money.mjs` 32 ×2 |
| Project-card journey (§47, §62) | `server/projectCards.test.ts` 25 · `evidence/zg-projectcards.mjs` 59 ×2 |
| Visual/role-arc gate (§70, §89·20) | `evidence/zg-visualqa.mjs` **550 ×2**, all six role workspaces + actionable-record census |

**§34's upload master pass is not in §42's list** and remains partial for one
reason only: a real S3 round-trip needs object-storage credentials this
environment does not have. The writers, ownership rules and IDOR guards are
covered by `evidence/zg-uploadfamilies.mjs`.

### The detail

These were the open items, and this is where each now stands:

| Gate | Status |
|---|---|
| Performance reviewed (§35, §63) | **GREEN** — `evidence/zg-performance.mjs` (29, twice, identical). Query count measured against result size, so an N+1 fails without a threshold; page-size caps, payload ceiling and the indexes behind every hot filter. Lab wall times recorded, not gated — §63's field data needs production telemetry |
| Reliability reviewed (§35, §64) | **GREEN** — `evidence/zg-reliability.mjs` (20, twice, identical) plus the existing outage, flood and allowance-race probes. Found and fixed two dead duplicate-key guards |
| SEO complete (§37, §66) | **GREEN** — `server/seo.test.ts` (57) and `evidence/zg-seo.mjs` (89, twice, identical), five mutations verified. One finding referred to the owner: `/vendor/:id` needs a session |
| AI release gate (§38) | **GREEN, with one item infrastructure-blocked** — `server/aiReleaseGate.test.ts` (14) maps each §38 item to the guarantee that proves it, over the 160 existing AI assertions; `evidence/zg-ai.mjs` (20, twice, identical) renders the unavailable state in EN and AR at 1440 and 375. No `OPENAI_API_KEY` here, so whether a live model obeys a correct instruction is not verified |
| ACC-4 fresh-account cross-role acceptance | **GREEN** — `evidence/zg-acc4.mjs` (116, twice, identical): six roles created through the real sign-up, each landing where the app sends them, EN and AR |
| Upload master pass (§34) | **PARTIAL — infrastructure-blocked** — `evidence/zg-uploadfamilies.mjs` (11) covers writers, ownership and IDOR guards; a real S3 round-trip needs object-storage credentials this environment does not have |
| Tracker reconciled (§41) | **GREEN** — `TRACKER_RECONCILIATION.md` classifies all 27 open items into §41's own categories, with evidence cited for every ALREADY COMPLETE claim. `server/trackerReconciliation.test.ts` (7) fails on an unclassified new item, an unknown category, or a cited file that does not exist. No tracker line was deleted |

**Therefore §42 no longer blocks merge authorization**, and §43's report can
honestly be made. What still cannot be claimed, and is not:

- **DEPLOYED / STAGING PREVIEW VERIFIED / STAGING VERIFIED** — `/version` cannot
  be read from this container, so no build has been observed serving. §89 is
  explicit that `render.yaml` is configuration, not proof.
- **MERGED** — needs explicit owner authorization (§3, §45).
- **OWNER DELIVERED** — needs the owner to open the deployed build and see the
  expected product (§2).

No pull request has been opened: that is an outward-facing action the owner has
not asked for in this session.

---

## An owner-found defect that stopped acceptance, and what it exposed

The owner clicked a card in the Project Manager's Project Queue and the product
did nothing. Six role workspaces rendered project rows as a bordered tile with a
title, a status badge and a progress bar — visually identical to every record
BuildHub lets you open — and every one of them was a plain `<div>`: no href, no
button, no tab stop, no focus ring. §47's first two questions, unanswered.

**The obvious fix would have been worse than the defect.** Those grids were fed
by `projects.directory`, a sanitized LEAD directory with no membership filter at
all. Linking each row to `/projects/:id` would have sent a provider into
`requireProjectAccess`, which correctly refuses, and replaced a dead card with a
NOT_FOUND. The owner said so explicitly, and the code agreed.

So the fix is the split, and `requireProjectAccess` is untouched:

| | Managed Projects | Project Opportunities |
|---|---|---|
| Source | `projects.list` — owned, or an active `projectMembers` row | `projects.directory` minus the managed rows, and only where an OPEN request exists |
| Destination | `/projects/:id`, the real workspace | `/rfq/:id`, the open request |
| Grants project access? | yes, as it always did | no — following it grants nothing |
| Renders | the project | title, type, status, location, progress and nothing else |

`shared/projectOpportunities.ts` decides which row earns which, from the managed
list alone — membership is never inferred from the directory. The Project
Manager's one mixed "Project Queue" is now two sections whose names describe what
each holds. A root cause sat beside it: `projects.list` was gated on
`role === 'homeowner'`, so no professional was ever told which projects were
theirs.

`client/src/components/ProjectCards.tsx` is now the only project card in the
product — two components rather than one with a `variant`, so a later edit cannot
hand an opportunity card the managed card's link.

### Proof, positive and negative, in a real browser

`evidence/zg-projectcards.mjs` — **59 checks ×2, EN and AR**: a project the
manager owns and one they are an active member of each open the real workspace;
an opportunity card opens the request; the stranger's project stays refused and
its budget never renders; every card is an anchor in the tab order with an
accessible name and a CTA in both languages. `server/projectCards.test.ts` — 25.

### Mutation-tested, and one gate hole found

Seven mutations, each applied to the real product and reverted:

| Mutation | Caught by |
|---|---|
| Managed card reverts to an inert `div` | 2 unit tests · **8 browser checks** (`DIV/false`, "card not found", URL unchanged) |
| Opportunity card links at the project | 1 unit test · **11 browser checks** across 2 languages and 5 roles |
| Membership inferred from the directory | 5 unit tests |
| Opportunity card starts rendering the budget | 1 unit test — **after the hole below was fixed** |
| `projects.list` gated on homeowner again | 1 unit test |

The budget mutation **survived the first attempt**. The assertion read
`not.toContain('project.budget')`, and `(opportunity.project as any).budget`
renders the same private field by another spelling. It now matches the field name
as a word anywhere in the card body, comments stripped. A gate that only catches
the spelling you thought of is not a gate.

### The journey is now in the final visual gate (§70, §89 item 20)

`evidence/zg-visualqa.mjs` covered the public site, the buyer, supplier settings
and Admin — and **not one `/platform/:role` workspace**. That is how six inert
grids reached the owner: the final visual gate never opened the pages they were
on. All six workspaces now join the sweep at 1440 and 375, in English and
Arabic, and the gate went from 434 checks to **550, twice, with no failure**.

Beside them is an **actionable-record census** that looks for the PATTERN rather
than for project cards: any tile that has adopted the visual language of a
record — the design system's rounded border, plus a status badge or a progress
readout — and is inert. It is mutation-proved in both directions: with the inert
card restored it reports 5 of 5 inert on the homeowner workspace, and it reports
none once the fix is back. Its first version was wrong in a way worth recording:
it kept the OUTERMOST card-shaped node and so reported the supplier's "Submitted
Quotations" *panel* as an inert record while the keyboard-operable tiles inside
it were filtered out. A panel contains cards; a record contains none.

### A third number that described the wrong population

Reviewing the diff caught one more: the Project Manager's **Average Progress**
tile sat in the Managed Projects group, beside two counts that are now the
manager's own, and averaged `projectDirectory` — every project on the platform.
Three figures in one group, two populations. It now averages the projects they
run, and a manager with none reads `—`, because averaging nothing is not 0%
progress. `server/projectCards.test.ts` covers both.

### Two real defects the extended sweep found on its first run

1. **Six nameless controls in the supplier catalogue (§62).** Each row's edit
   control was `<Link><Button aria-label=…>` — an anchor wrapping a button, two
   focusable elements for one action, and the outer one, the one the keyboard
   reaches first, had no accessible name at all. `asChild` collapses them into a
   single anchor carrying the label. It is the only instance in the product.
2. **The label then named the product in the wrong language.** The first fix
   wrote `Edit ${product.name}`, while the Arabic row shows `nameAr` — so a
   screen reader was told about a product the page did not appear to show. Label
   and row now use one name.

### Probe hygiene, found while running these gates

Three probes were polluting the database the other gates read.
`evidence/zg-referralcodes.mjs` had **no teardown at all** and had left fifteen
accounts behind over three runs; `evidence/zg-journey-homeowner.mjs` swallowed a
`referralCodeEvents` foreign-key refusal and leaked six while reporting 24/24.
Both now delete in foreign-key order and **prove** the removal as a check. All
stale fixtures were purged; the nine `zid…`/`zsearch…` accounts that remain are
the deliberate persistent fixtures other probes sign in as.

`zg-errorstates`, `zg-a11y` and `zg-responsive` sweep the *previous* run's
account on entry rather than removing their own on exit, so exactly one row of
each lingers between runs. Not fixed here, to keep this pass to the defect and
its gates; the fix is the same shape as the two above.

### A stale assertion this exposed, replaced and mutation-proved

`zg-journey-homeowner` asserted a fresh homeowner's dashboard shows
`EGP 0` for Total Spent. That was the Egypt default §88 removed: a total over no
rows has no market, so `formatMoneyTotals` returns null and the KPI shows an em
dash beside a truthful "0 Total Projects". The replacement was **vacuous on its
first two attempts** — one looked only forward from a label whose value renders
above it, and the next accepted the em dash from the card 20 characters away
while its money pattern wanted "12,400 EGP" where the product writes
"EGP 12,400". The KPIs now carry stable `data-testid`s and the check reads the
exact element; fabricating a spend total fails it, naming the value.

---

## Finishing, quotation pricing strategies and the AI click contract

`FINISHING_AND_AI_CONTEXT.md` is the authoritative behaviour; `CLAUDE.md` §90
points at it. Implemented by composing the canonical request, quotation, money,
role and AI architecture — no parallel workflow was created.

**The defect that started it.** Clicking an AI suggestion or a tool card wrote
the product's own text into the transcript as `role: 'user'` and submitted it in
the same tick (`onSendMessage(prompt)`, `handleSend(t(mode.promptKey))`). A
transcript is the record of what somebody asked; writing into it on their behalf
makes that record untrue. A click now establishes context only: choosing a
suggestion fills the composer, focused and editable, and sending stays a
deliberate act. Suggestions are derived server-side from object, subtype,
session role, workflow stage and the viewer's permitted projection.

**Three pricing strategies inside one quotation.** Percentage of material cost,
package, and detailed/BOQ, plus the existing `custom` behaviour as the default.
`shared/quotationPricing.ts` holds the only implementation of the arithmetic;
`quotations.price` remains the single authoritative total and the server derives
it — a submitted total for a derived method is refused, not ignored.

| Gate | Evidence |
|---|---|
| Calculation engine | `server/quotationPricing.test.ts` 40 |
| AI click contract | `server/aiSuggestionContract.test.ts` 25 |
| Finishing request | `server/finishingRequest.test.ts` 37 |
| End-to-end journey | `evidence/zg-finishing.mjs` **41 ×2**, one honest SKIP |
| Migration 0062 | empty DB + populated upgrade, lossless `price` widening verified |

**Two defects the probe caught that types could not**, both now fixed and
mutation-tested: a `json` column read back as a string (so the comparison
silently reported no scope differences at all), and a suggestions endpoint that
was an id oracle for every signed-in account. Details in
`FINISHING_AND_AI_CONTEXT.md` §11.

**Deferred and stated**: the composer-fill assertion needs an AI credential this
environment does not have, so the probe skips it and proves instead that a click
appends no user message; per-trade percentage tables are not built, because the
canonical model has one base per quotation and the BOQ serves that case.

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

## The two findings referred to the owner — both now resolved

**The provider storefront is public.** `/vendor/:id` was a `protectedProcedure`,
so a signed-out reader and every crawler got "Please sign in" on the page §21
and §37 both describe as public. The owner decided; it is open now.

Opening it needed a visibility gate, not just a procedure keyword. The only
check was the account's ROLE — tolerable behind a session, not in public, where
a stranger walking ids would have reached an unapproved applicant's page. A
stranger now sees exactly what the DIRECTORY shows, through
`directoryVisibilityFilter()`, and an unapproved, frozen or deactivated account
answers NOT FOUND with the same message as an id that never existed. Self and
admin keep the access they already had.

Nothing private moved: the tiers are a property of the columns, and
`vendorContactAccess` already answered `none` for a null viewer. Proven field by
field — the named contact, their email, phone, mobile, street address and the
commercial registration are all absent from a stranger's payload.
`contactChannel` gained a third state, `sign_in`, because telling a stranger the
provider "cannot be contacted" would be false.

**And the portfolio had to move with it.** `portfolio.list` was still a
`protectedProcedure`, so the storefront rendered its Portfolio section to a
signed-out buyer and filled it with nothing — which reads as a claim about the
PROVIDER ("no work shown") rather than about the reader. §21 lists portfolio
among a storefront's sections. It is public now, and it gained the visibility
rule it never had: it used to take any `userId` and return every row without
checking the account was even a provider.

Evidence: `server/publicStorefront.test.ts` (21),
`evidence/zg-publicstorefront.mjs` (50 ×2). Three mutations verified: removing
the visibility gate publishes unapproved accounts; treating a null viewer as
engaged leaks the whole contact block onto the page; re-protecting the portfolio
empties the section for every signed-out reader.

**Service prices carry their own currency.** Migration `0061` adds
`serviceOfferings.currency`, backfilled to `EGP` — which is what every existing
row already meant, and the legitimate legacy absence §88 allows. `services.create`
writes it from the market rather than relying on the default, both readers return
it, and both screens render it through the canonical formatter. The two declared
hard-codes in `server/marketReadiness.test.ts` are gone, and the reason they were
declared — the debt is the column, not the view — is why adding the column
removed both at once.

Evidence: `server/serviceCurrency.test.ts` (15), `evidence/zg-money.mjs` (35 ×2,
now rendering one EGP and one SAR offering on the same storefront). One mutation
verified: hard-coding the currency again renders `EGP 300 – EGP 480` on a Saudi
service.

## Owner decisions still open

- Protect `main` with a GitHub ruleset (governance authorization).
- `projects.spent` vs the live expense-log sum — recorded as settled in
  `OWNER_DECISIONS.md`; the tracker entry is a duplicate to retire.
- Team / Organization architecture: post-release.
- Payment gateway: owner-deferred, and every "no budget / no CPC / no revenue"
  guarantee in the Marketing Center depends on it staying deferred.
