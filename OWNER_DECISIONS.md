# BuildHub — Owner Decision Reconciliation

**One file. Every decision that is the owner's to make, what the product does
about it today, and what is actually blocked.**

This exists because "owner decision" had become a place items went to stop
being looked at. Each row below was re-derived from the code and the database
in this pass — not from an earlier report — and says which of three things it
is:

| State | Meaning |
|---|---|
| **DECIDED IN CODE** | The product already behaves one way, deliberately. The owner is being asked to confirm or overturn, not to unblock. |
| **OPEN — OWNER** | The product cannot proceed correctly without an answer. Named consequence, named recommendation. |
| **BLOCKED — EXTERNAL** | Not a decision at all. Something outside this repository is missing. |

Nothing here is a plan to build. Where a row already has working behaviour,
the evidence is named so it can be checked rather than believed.

---

## 1. `projects.spent` vs the expense log — **DECIDED IN CODE**

**What was found.** `projects.spent` is settable only through an optional
field on `projects.update` that **no screen in the product sends**. The column
has never been filled by anything a person can do. Meanwhile the project page
totalled the expense log correctly. So the homeowner dashboard headlined
"Total Spent: EGP 0" beside a project page reading EGP 2,000.

**What the product does now.** Spend is derived from the expense log
everywhere, through one reader (`server/projectSpend.ts`), in one grouped
query per list rather than one per project. `projects.update` no longer
accepts `spent` at all — it returned `{ success: true }` for a write nobody
would ever see.

**Evidence.** `evidence/zg-projectspend.mjs` — 3/8 before, 8/8 after. Writing
999999 straight into the column no longer changes what a homeowner is shown.

**Still the owner's.** Whether a project should *also* accept a manually
stated total — for work invoiced in a lump, or a figure carried over from
before the project was on BuildHub. That needs its own field and a visible
marker saying the number was typed rather than totalled. **The column is left
in place, unread, so that option stays open.** Dropping it would foreclose it.

---

## 2. Messaging: prior-relationship policy — **OPEN — OWNER**

**The question, unchanged.** May any account message any other, or must there
be a shared RFQ, quotation or directory enquiry first?

**What the product does now.** No relationship is required. A customer can
contact a vendor they have just found. This is deliberate and is what the
marketplace is for.

**What tracing it found, which is not a policy question.** With no
relationship gate, the rate limit is the only thing between one stolen account
and every vendor in the directory — and `messages.send` had **no limit at
all**, while `rfq.create`, all twelve upload paths and placement analytics
were all bounded. Proven over the real endpoint: seventy-eight messages to
twelve strangers in seconds, every one stored, every one notified.

**Now bounded on two axes.** Volume (15/min, 150/hr) and **breadth** (20 new
conversations an hour). Only a *first* contact is charged, and the pair is
looked up in both directions, so a vendor answering a customer who wrote first
is continuing a conversation rather than starting one.

**Evidence.** `evidence/zg-messageflood.mjs` — 4/7 before, 11/11 after, with
the breadth rule exercised under a paced send so it cannot pass because the
volume rule fired first.

**Recommendation.** Keep the open policy — it is the product — and treat the
limits above as the control that makes it safe. Revisit only if real abuse
appears, and tighten breadth before adding a relationship gate.

---

## 3. Supplier answers: editing and moderation — **DECIDED BY OWNER, NOW BUILT**

**Owner direction given, 22 September.** Do not launch a public product Q&A
surface with no moderation path. Both halves are now implemented.

**Editing.** A supplier may correct their own answer. The previous text is
kept in `productAnswerRevisions`, the listing carries an "Edited" marker, and
the buyer who asked is notified that it changed — because an editable public
answer is otherwise a way to rewrite history: answer "yes, we ship to
Alexandria", take the order, quietly change it to "no". A hidden answer cannot
be edited, so moderation cannot be rewritten out from under.

**Moderation.** Built on the *existing* review-report architecture rather than
as a second system: `shared/contentModeration.ts` now holds the one lifecycle
both obey, and `shared/reviews.ts` draws its statuses and actions from it
instead of restating them. Anyone signed in can report a question or an answer
*separately*; nobody can report their own words; one report per person per
target. Administrators get a queue carrying the product, the supplier, the
reporter, the reason and which half was reported, with hide/restore per half,
a required reason to hide, a resolution note, and an attention badge. Hiding is
never deletion — content stops rendering publicly and stays fully auditable.

**Evidence.** `evidence/zg-qamoderation.mjs` — 25/25, mutation-tested.

**Superseded record of the gap, kept because it explains the shape of the fix:**

**What the product does now.** A supplier answers a product question **once**.
A second attempt is refused with `CONFLICT`. There is no edit path.

**The gap, which is larger than the editing question.** `productQuestions` has
exactly three surfaces: list, ask, answer. **There is no moderation path of
any kind.** A question containing abuse, a phone number or a competitor's
contact details is published on a product page and *nobody* can remove it —
not the supplier, not an administrator. Reviews have a report-and-resolve
queue (`reviewReports`, surfaced in the admin console with an attention
badge). Questions have nothing.

**Recommendation.** Two separable decisions:

- *Editing*: allow a supplier to correct their own answer, with the previous
  text kept and an "edited" marker shown. A typo that cannot be fixed is a
  worse outcome than a visible correction.
- *Moderation*: extend the **existing** review-report architecture to cover
  questions and answers rather than building a second queue. It already has
  the report table, the admin surface and the attention badge.

**Not built pending the owner's answer**, because both are explicitly on this
list. The moderation gap is the higher priority of the two.

---

## 4. Admin impersonation — **OPEN — OWNER (security architecture required)**

**What the product does now.** Nothing. There is **no impersonation mechanism
at all** — the only occurrences of the word in the codebase are a prompt-safety
comment and a warning about a company's own verification number.

**Why it is not simply a feature request.** Acting as another user touches
every authorization decision in the product simultaneously. A safe version
needs, at minimum: explicit per-session grant, a hard time limit, a banner the
impersonated-as view cannot hide, every action written to the audit trail as
*the administrator acting as* rather than as the user, and a refusal to
impersonate another administrator.

**Recommendation.** Do not build it for launch. A read-only "view as" — which
renders what a user would see without acquiring their ability to act — answers
most support questions at a fraction of the risk, and can be added later
without rework.

---

## 5. Team / organization model — **OPEN — OWNER (architectural)**

**What the product does now.** There are **no team or organization tables**.
Authorization is per-user throughout, with project membership
(`projectMembers`) as the only multi-person structure, and it is scoped to a
single project.

**Consequence if it is wanted.** Company-level membership is not a feature
that sits beside the current model — it changes the subject of nearly every
permission check from a person to a person-in-a-company. It is a milestone,
not an increment.

**Recommendation.** Out of scope for this release candidate. Decide it as its
own piece of work; the current per-user model is coherent and nothing in it
has to be undone first.

---

## 6. Payment gateway — **BLOCKED — EXTERNAL (owner-deferred)**

**What the product does now.** `server/billing/provider.ts` defines a
provider-agnostic seam. The billing domain depends only on that interface and
imports no provider SDK, so adding Paymob — or Stripe, or a GCC provider —
is a new file implementing the interface, not a rewrite. **No provider
integration exists.** `vendorSubscriptions` is the only money-adjacent table.

**What is blocked.** No sandbox or test merchant account is available, so
provider behaviour cannot be implemented without guessing at it.

**Standing constraint, unchanged.** No live payments, orders, transactions,
revenue, GMV, commissions or cash rewards anywhere in the product. Nothing in
this release candidate reports any of them.

---

## 7. RFQ budget exposure — **DECIDED IN CODE**

**What the product does now.** The RFQ feed is for **approved providers only**.
A non-provider sees only their own requests — one homeowner can no longer read
another homeowner's brief or the figure they are willing to spend. An approved
provider sees the **exact budget**.

**Still the owner's, if they want it changed.** Whether an approved provider
should see the exact figure or a band before bidding. Exact figures help a
provider self-select out of work they cannot do; bands protect the customer's
negotiating position. The current answer is "exact".

---

## 8. Provider comparison surface — **OPEN — OWNER**

**What the product does now.** Products can be compared side by side in the
marketplace. Quotations can be compared (`QuotationComparison.tsx`).
**Providers cannot.** There is no surface for placing two contractors or
suppliers beside each other.

**Recommendation.** Lower priority than it looks. A customer comparing
providers is usually comparing their *quotations*, which already exists. A
provider comparison built on profile fields alone risks implying a ranking the
data cannot support.

---

## 9. Mandatory product fields — **DECIDED IN CODE**

**What the product requires today.** `name` and `category`. Everything else —
price, stock, unit, brand, origin, delivery time, warranty, description — is
optional. A product with no price renders honestly as "Price on request"
rather than as a number nobody committed to.

**Still the owner's.** Whether price and unit should be mandatory for a
*published* product (as opposed to a draft). The lifecycle already
distinguishes the two, so the rule has somewhere to live if it is wanted.

---

## 10. Renovation / finishing preset — **OPEN — OWNER**

**What the product does now.** `finishing` exists as a marketplace route and
as an AI intent, so a visitor can ask for finishing work and be taken
somewhere sensible. There is **no project preset** — no template that
pre-populates a renovation or finishing project with typical phases or
categories.

**Recommendation.** A preset is content, not architecture, and can be added at
any time. It does not block the release.

---

## 11. Protecting `main` with a GitHub ruleset — **OPEN — OWNER (governance)**

**Why it is not done.** Creating a branch ruleset changes how the repository
itself behaves for every contributor. That is an owner action, and it is on
the standing list of things not to do silently.

**Recommended ruleset.** Require a pull request before merging; require the
existing checks to pass; block force pushes; block deletion. No approval count
is proposed — the owner is currently the only reviewer, and a rule nobody can
satisfy is worse than none.

---

## Standing constraints still in force in this branch

These are not decisions pending; they are limits being observed.

- No production deployment, no production database operation, no payment
  activation.
- `main` is never merged without explicit owner authorization.
- No staging database write, and no reconciler run against staging, without
  owner authorization.
- No secrets committed or printed.
- `MAIN == STAGING`, `DEPLOYED` and `STAGING VERIFIED` are not claimed
  without evidence. Render is 403 to this environment by organization egress
  policy, so the deployed build cannot be verified from here — that is
  reported, never routed around.
- SMTP and S3 remain infrastructure-blocked wherever real proof needs them.
- Migrations **0056** (product Q&A moderation) and **0057** (referral code
  lifecycle) are applied **LOCALLY ONLY**. Both are additive — new columns and
  new tables, nothing dropped, nothing retyped, no row rewritten — and both
  backfill honestly: 0057 gives every existing code `status = 'active'`, which
  is exactly how it behaved before, and a NULL issue date, because the date a
  historic code was minted was never recorded and inventing one would be worse
  than admitting it is unknown. They reach staging through normal integration,
  not by hand.
- Migration **0058** (market context) is applied **LOCALLY ONLY** on the same
  terms: new columns only, backfilled `EG` / `EGP` / `GLOBAL`, which is what
  every existing row already meant while BuildHub operated in one market.
- **No GCC market is enabled.** `enabled: false` on all six in
  `shared/markets.ts` is the only thing that decides, and flipping one is an
  owner decision behind the readiness gate in `GCC_SCALE_READINESS.md`. A
  market with no service-area vocabulary, no confirmed compliance set and no
  approved price catalogue is a country in a dropdown, which §86 says is never
  sufficient to call a market launched.
