# BuildHub — Work Report

**Branch:** `claude/buildhub-audit-verification-vrai7l`
**Head:** `bfe9b1a`
**Position:** 56 commits ahead of `origin/main`
**Generated:** 2026-09-12

---

## 1. Summary

This report covers the work completed on the development branch, in detail for the
six milestones delivered in the most recent session and at summary level for the
branch as a whole.

| | |
|---|---|
| Milestones delivered this session | 6 (ELIG, ENQ, PMEM, QUOTE, NOTC, DISC) |
| Code changed this session | 64 files, +5,532 / −183 lines |
| Automated tests, whole repository | **4,312 passing** across 190 files |
| Typecheck (`tsc --noEmit`) | clean |
| Production build | clean |
| Live probes added this session | 8, each run twice with identical verdicts |
| Mutations killed this session | 44 |
| Tracker items | 343 complete, **36 outstanding** |

Every milestone followed the same discipline: reproduce the defect against the
running product first, fix it, prove the fix with unit tests and a live probe,
mutation-test both, run the full gate, commit, push, and verify local SHA equals
remote SHA.

---

## 2. Milestones delivered this session

### 2.1 ELIG — `4affd1d` — do not offer an enquiry the server will refuse

**Reported from real use.** A provider was shown an enabled "Open qualified
enquiry" button, clicked it, and was told the request did not match any of their
declared service categories. The refusal was correct. Offering the action was not.

Nothing could answer "would opening be granted?" before the click, because that
decision lived only inside `openQualifiedEnquiry`, which spends a credit and so
cannot be called to find out.

**Delivered.** `previewQualifiedEnquiry` answers it read-only — it writes nothing,
marks no invitation viewed and spends no allowance, so it is safe on render. It
shares the act's helpers rather than restating the rule: the same
`hasOpenInvitation`, `isClassifiableRfqCategory`, `getVendorCategories`,
`isVendorEligibleForCategory` and `getEnquiryUsage`, in the same order. Every
refusal reaches the screen as a key, never a server-built sentence, so the Arabic
screen is not handed English. The button is absent rather than disabled, with the
reason and a "Manage service categories" link in its place.

**The probe then caught a real defect in the new code.** The procedure skipped the
preview whenever the caller could already respond — but an open *invitation* is
itself "can respond", so the preview's invitation branch could never run, and the
payload answered `canOpen: false` to a provider whose `openEnquiry` call returns
200. An invited provider is entitled to that work. The preview is now
unconditional, and the unit test that asserted the skip now forbids it.

**Evidence:** `server/enquiryPreview.test.ts` (22 tests), 13 mutations killed;
`evidence/zg-eligibility-run1/2.txt` (19/19 twice) and the rendered
`evidence/zg-eligibilityui-run1/2.txt` (20/20 twice).

---

### 2.2 ENQ — `2a34062` — a provider work queue that keeps what they paid for

Three defects, each reproduced against the running product first.

1. **A lead the provider paid for disappeared.** The board read
   `where status = 'open'`, so the moment the customer closed or awarded the
   request it vanished from the only list the provider had — while the credit
   stayed spent and the usage meter still counted it. Nothing else in the product
   listed it: every other provider-scoped read of `qualifiedEnquiries` was a
   single-row existence check or a monthly count.
2. **It truncated silently at 50** and returned a bare array with no total — the
   defect class `server/adminList.ts` exists to end, on a provider's commercial
   work queue rather than an administration screen.
3. **The page lied about itself.** `/enquiries` was titled "Qualified enquiries"
   and subtitled "The requests you have opened", over a list of requests they
   *could* open.

**Delivered.** `server/enquiryQueue.ts` unions the three ways a request reaches a
provider in one query, so the count and the rows cannot disagree. An opened
enquiry and an invitation are included at *any* RFQ status — they are records, not
offers, and a receipt that vanishes when the other party closes the file is not a
receipt. Only the category arm is limited to open requests. `source` and
`responseState` are SQL expressions the list returns *and* the filters compare
against, so a row cannot be labelled one thing and filtered as another. Paged
through the canonical `adminPage`, searched through the canonical `containsTerm`.
The truncating helper was deleted rather than left one import away.

**Census hardening.** The truncation census reads only `routers.ts`, so the
truncation living in a helper was invisible to it. It now covers the helper
modules the routers delegate list reads to, judges each `.limit()` by *its own
chain* rather than by whether anything in the file is paged, and counts a
`limit = 50` default parameter as the truncation it is.

**Evidence:** `server/enquiryQueue.test.ts` (28 tests, several rendered through
the real MySQL dialect so they assert the SQL the database receives), 17 mutations
killed; `evidence/zg-enquiryqueue-run1/2.txt` (26/26 twice) and
`evidence/zg-enquiryqueueui-run1/2.txt` (20/20 twice).

---

### 2.3 PMEM — `654f137` — project membership

Viewing, adding and the capability model already worked, and removal already
revoked access correctly — the probe proves that rather than assuming it. Three
real defects:

1. **A capacity could not be changed at all.** `addMember` refuses a live member
   with CONFLICT, so promoting the site engineer to manager meant *removing* and
   *re-adding* them — resetting `assignedAt`, erasing the `removedAt`/`removedBy`
   that record they were ever taken off, and sending a "You were added to a
   project" notification for a project they never left.
2. **`removeMember` reported every real removal as `removed: false`.** It read
   `result.rowsAffected`; mysql2 answers `[ResultSetHeader]` and the count is at
   `result[0].affectedRows`. That flag exists precisely to tell "I took somebody
   off" from "that person was not on it", and both answered false while the screen
   toasted "Member removed!" either way. There were three spellings of that read
   in the codebase, which is how one ended up wrong.
3. **None of it was audited**, although it decides who can read the customer's
   documents, RFQs and quotations.

**Delivered.** `projects.changeMemberRole` as its own verb — same `manage`
capability, ownership still ungrantable, the owner's own capacity untouchable, and
a *removed* member is not promoted back in, because quietly restoring access is
the opposite of what removing them meant. One canonical affected-rows reader in
`server/_core/writeResult.ts`, defensive about the shape rather than the spelling
and returning 0 rather than NaN for an answer it does not recognise. Migration
`0053` widens `commercialAuditEvents.subjectType` with `project`, and all three
membership acts are recorded; `subjectId` is the project, never the person,
because "everything that happened to project 12" is the question a dispute asks.

**Evidence:** `server/projectMemberRole.test.ts` (18 tests), 6 mutations killed;
`evidence/zg-projectmembers-run1/2.txt` (26/26 twice). Five existing census suites
caught the change and were each restated at the rule's new address rather than
bumped.

---

### 2.4 QUOTE — `29d24c7` — a quotation's validity is enforced, not only displayed

The detail page, statuses, comparison, warranty, timeline, both terms fields,
attachments, accept/reject and the revision model all already worked. One real
defect, and it was the commercial one.

**`validUntil` was enforced nowhere.** It is required on every quotation, stored,
rendered on the comparison screen and pinned in the field history — and nothing
ever read it back. Reproduced: a quotation whose validity ended on 1 January was
**accepted on 12 September**, its status moved to `accepted`, every other bid on
the request was auto-rejected around it, and nothing had told the customer the
price was months stale. A supplier who writes "this holds until 1 October" means
it.

**Delivered.** `shared/quotationValidity.ts` is the one rule, imported by both
halves rather than restated. The day is inclusive, because the submission rule
already reads it that way and accepts a validity of today. A quotation with no
validity date is not expired — historical rows predate the requirement, and
retiring bids nobody withdrew would be a second defect. The act refuses inside the
transaction and after the row lock, beside the status check. Rejecting an expired
bid is still allowed. Expiry is derived at read time on all three readers — the
customer's comparison, the supplier's own list, the detail page — never stored,
because BuildHub has no job runner. The screen withholds the accept button, keeps
reject, marks the card, and **"Best value" is no longer awarded to a bid that
cannot be accepted**.

**Evidence:** `server/quotationExpiry.test.ts` (19 tests), 7 mutations killed;
`evidence/zg-quotationexpiry-run1/2.txt` (18/18 twice). Disabling the check takes
the probe to 10/18.

---

### 2.5 NOTC — `2e3c03a` — notification centre

Scoping was never the problem: a notification carries a `userId` and every read
and write in the router takes its subject from the session. Two real defects:

1. **The badge was all-or-nothing.** `markAllRead` was the only writer of
   `read: true` anywhere in the codebase, so somebody with forty unread who opened
   *one* had to clear every one of them or keep a number that no longer described
   what they had seen — the same defect messaging carried before MSG.
2. **One notification pointed at a page that does not exist.** An admin handed a
   batch of enquiries was linked to `/admin/enquiries/assignee/<id>`, which matches
   no route — `/admin/:section/:record` is three segments and that is four — so the
   notification landed on "404 Page Not Found". Confirmed by loading it in a
   browser, not inferred from the route table.

**Delivered.** `notifications.markRead` takes an id and no userId: the subject is
still the session, and the id is constrained in the same WHERE rather than checked
beforehand, so an id belonging to somebody else matches no row. Opening a
notification reads it, linked or not. The assignment link now points at
`?assignee=`, which the server has accepted as a filter since VE-6 with nothing
ever sending it, and the narrowing is visible on screen with a way to clear it.

**A class, not an instance.** A link is written in one file and resolved in
another, and nothing connected them. The new suite walks every destination the
server writes and requires a declared route that can serve it.

**Evidence:** `server/notificationCentre.test.ts` (13 tests), 6 mutations killed;
`evidence/zg-notificationcentre-run1/2.txt` (17/17 twice).

---

### 2.6 DISC — `bfe9b1a` — marketplace discovery

Most of discovery was already reconciled, and the survey records that rather than
redoing it: Home renders a figure only when it is a real non-zero count; the
designer and finishing directories render the same authorized vendor directory as
`/marketplace/vendors`, filtered to a category providers actually declare; the
hub's product chips and search suggestions come from the one canonical taxonomy.

**One real defect.** Of the four numbers on the hub's section cards, two counted
real things and **two counted a constant compiled into the page** —
`DESIGN_CATEGORIES.length` (14) labelled "disciplines" and
`FINISHING_CATEGORIES.length` (21) labelled "services". With no designer on the
platform the card still read "14 disciplines": a number that cannot move, in the
same slot and typeface as one that can. The hub was already computing the real
designer and finishing lists for its suggestions and featured strips — it simply
was not using them for the headline figure.

**Evidence:** `server/marketplaceDiscovery.test.ts` (11 tests), 5 mutations
killed; `evidence/zg-discovery-run1/2.txt` (14/14 twice) — the card reads 0 on an
empty platform, two designers sign up and it reads 2, and the finishing card that
gained nobody does not move.

---

## 3. Verification record

### 3.1 Live probe verdicts (each run twice, identical)

| Probe | Verdict |
|---|---|
| `zg-eligibility` | 19/19 |
| `zg-eligibilityui` (rendered) | 20/20 |
| `zg-enquiryqueue` | 26/26 |
| `zg-enquiryqueueui` (rendered) | 20/20 |
| `zg-projectmembers` | 26/26 |
| `zg-quotationexpiry` | 18/18 |
| `zg-notificationcentre` | 17/17 |
| `zg-discovery` (rendered) | 14/14 |

Every probe was mutation-tested against the defect it exists to catch.

### 3.2 Instrument failures found and fixed

Six instruments produced a wrong answer before the product did. Each was fixed in
the instrument, not accommodated:

- **A surviving mutation on the eligibility preview** — two assertions anchored on
  a line the mutation itself rewrote, so `indexOf` returned −1 and `slice(start, −1)`
  handed one of them almost the whole file while `slice(−1)` handed the other a
  single character. Every boundary in that file is now proven before it is used.
- **A shared CDP cookie jar** — cookies belong to the browser, not the tab, so
  signing the invited provider in silently re-authenticated the mismatched
  provider's open page and the probe read the wrong person's screen. Identity is
  now re-asserted and checked on every navigation.
- **Fixed sleeps** — an assertion that a button is *absent* passes for free
  against a page that has not rendered. Replaced with a real readiness condition.
- **`last_insert_id()` on a fresh connection** — each `mysql` call is a separate
  connection, so twenty-two seeded fixtures were collected as id 0.
- **A notification probe that navigated to a hard-coded URL** — it proved the page
  existed and said nothing about where the notification points, and passed
  unchanged when the dead link was restored. It now makes a real assignment and
  follows the link the server stored.
- **Backticks around the reserved column `read`** eaten by the shell; the probe
  now passes SQL on stdin.

### 3.3 Existing census suites that caught this work

Each was restated at the rule's new address or acknowledged with a written reason
— none was weakened or bumped:

`rfqTargetingAuthorization`, `commercialAudit`, `dataIsolationMatrix`,
`adminInvitations`, `testLoginLinks`, `reachability`, `negativeControls`,
`notificationDestinations`, `providerResponseHandoff`, `adminList`,
`inventory`, `migrationSyntax`.

### 3.4 A correction

I wrote "12" in three comments describing the hardcoded design-category list. The
list has 14 entries. The probe assertion that depended on that guess now checks
both real lengths (14 and 21) rather than one remembered number.

---

## 4. Outstanding work — 36 tracker items

### 4.1 Blocked by infrastructure (reported as such, never converted to passes)

- SMTP — no mail has ever been sent
- Object storage (S3) on staging
- Payment provider — owner-deferred; no live payments, orders, revenue, GMV,
  commissions or cash rewards

### 4.2 Awaiting an owner decision

- `projects.spent` vs a live expense-log sum
- Messaging prior-relationship policy
- Supplier answer editing / moderation policy
- Admin impersonation — classified as *security architecture required*
- Team / organization model (a company role model and authorization plan)

### 4.3 Not built, recorded rather than left looking forgotten

- **Quotation withdrawal** — `quotations.status` has no `withdrawn` value although
  the commercial-audit union carries the verb, so a supplier must let a bid expire
  or ask the customer to reject it. A schema change and its own piece of work.

### 4.4 Remaining engineering backlog

Per-role self-service second passes (homeowner, project manager, contractor /
engineer / architect / designer); compliance self-service and admin queue
completeness; admin console consistency (sort, pagination, entity links, raw-ID
removal across remaining tables); admin global search opening entity management;
RFQ basket workflow and RFQ detail navigation completeness; upload master pass;
onboarding reconciliation; role-specific quick actions; promotion management
accuracy; admin analytics on real data only; AI accuracy, security and knowledge
completeness; performance review (unbounded queries, N+1, indexes, payloads);
reliability review (double-submit, idempotency, race-sensitive flows); public
marketplace SEO; accessibility and mobile/RTL visual QA at 375/768/1440.

---

## 5. Release position

- **PR #42 is open and unmerged.** The branch is **56 commits ahead of
  `origin/main`**.
- **Merging to `main` requires explicit owner authorization.** I do not have it.
- **Production deployment requires explicit owner authorization.** I do not have
  it.
- Staging may be used for verification where already authorized.

All work described above is committed and pushed to
`claude/buildhub-audit-verification-vrai7l`, with local and remote SHA verified
equal after each push.

---

## 6. Standing rules held throughout

- No test weakened to go green. A failing test means either a product defect to
  fix or an invalid test to correct with proof and no loss of coverage.
- Every new guard mutation-tested.
- No fabricated users, vendors, orders, payments, revenue, reviews, ratings,
  sponsors, transactions or analytics. Zero real data produces a truthful empty
  state.
- Authorization enforced server-side; never by hiding UI.
- No duplicate systems where a canonical architecture already exists.
- Infrastructure limits stated as limits, never reported as passes.
