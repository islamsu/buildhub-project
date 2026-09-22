# BuildHub — Admin Management-Action Discoverability Census

**CLAUDE.md §84 · PRODUCT_NORTH_STAR.md §37**

> A management destination exists, but the important management actions are not
> obvious, not complete, or are buried deeply enough that the product looks
> unfinished.

That is the failure mode this census exists to find. It is **not** a pass/fail
gate over every cell: several of the blanks below are correct, and the reason
each one is correct is recorded here rather than argued again later.

Re-derive with `node evidence/zg-admincensus.mjs` against a running build.
The probe reads its destinations from `client/src/lib/adminNavigation.ts`, so a
destination added to the sidebar and forgotten here is one the census still
walks.

---

## Result, 22 September, `claude/buildhub-global-release-candidate`

| destination | create | search | filter | page | detail | lifecycle | history |
|---|---|---|---|---|---|---|---|
| `/admin` | – | – | – | – | yes | yes | – |
| `/admin/users` | yes | yes | yes | yes | yes | – | yes |
| `/admin/registrations` | – | – | yes | – | – | yes | – |
| `/admin/categories` | yes | yes | yes | – | yes | yes | – |
| `/admin/placements` | yes | yes | yes | yes | yes | yes | – |
| `/admin/enquiries` | – | yes | yes | – | – | – | – |
| `/admin/referrals` | yes | yes | yes | yes | yes | yes | yes |
| `/admin/disputes` | – | yes | yes | yes | yes | yes | yes |
| `/admin/support` | – | yes | yes | yes | yes | yes | – |
| `/admin/reviews` | – | – | yes | yes | – | – | – |
| `/admin/billing` | – | yes | – | – | – | – | – |
| `/admin/analytics` | – | – | – | – | – | – | – |
| `/admin/operations` | – | yes | yes | yes | yes | – | yes |
| `/admin/admins` | yes | – | yes | – | – | yes | yes |
| `/admin/settings` | – | – | – | – | – | – | – |

Create actions found, verbatim from the rendered screen:

- `/admin/users` — Create account
- `/admin/categories` — New category
- `/admin/placements` — Grant sponsorship
- `/admin/referrals` — New campaign · Issue code
- `/admin/admins` — Invite administrator

---

## What is asserted, and therefore cannot regress

- every destination in the menu **renders**, and **does not bounce** the
  administrator to `/auth` or anywhere else
- no destination is a shell
- every domain whose records **Admin legitimately creates** has a visible
  create action
- every list that **grows without bound** has search and pagination
- **all 48 Admin mutations** have a client that calls them, or an entry in
  `server/reachability.ts` saying why not

---

## The blanks that are correct

**No create on Disputes, Support, Reviews, Enquiries, Registrations.** A
dispute is raised by a user. A support ticket is opened by the person who needs
help. A registration is submitted by the applicant. An enquiry records that a
supplier opened a real lead. A create button on any of them would fabricate the
record the queue exists to hold — the same rule that keeps "Create referral" off
Referral Management.

**No search on `/admin/admins`.** Platform administrators are a small, bounded
set by design; the page lists all of them.

**No lifecycle on `/admin/users`.** Verify, suspend and reactivate live on the
user's own 360° detail page, where the confirmation and the reason belong.

**Nothing on `/admin/analytics` and `/admin/settings`.** Neither is a record
list. Analytics reads instrumented metrics; Settings edits a fixed set of
values.

---

## The blanks that are candidates, recorded rather than quietly fixed

Each is a decision about a surface, not a defect in one.

| gap | consideration |
|---|---|
| `/admin/reviews` has no detail view | Moderation happens from the row today. A reported review with a long thread may warrant a detail pane. |
| `/admin/billing` has no filter, paging or detail | The page is thin because payment is owner-deferred; it holds plans, entitlements and manual overrides. Worth revisiting when there is more to page through. |
| `/admin/categories` has no pagination | 55 categories render at once. A real limit exists somewhere above this. |
| `/admin/enquiries` has no row detail link | It opens a detail pane in place rather than a route, which the census cannot see. Confirm by hand before treating it as a gap. |
| `/admin/registrations` has no search or paging | The queue is bounded by pending work today. It will not stay bounded. |

---

## Three ways this census was wrong before it was right

Recorded because each produced a confident, false report, and because the same
traps sit under every rendered probe in this repository.

**It read its own list of exempt procedures.** Six billing mutations were
reported as having no rendered control. They are the payment-provider webhook
writes, already declared in `server/reachability.ts` with the reason — a manual
button for them would let an administrator record revenue BuildHub never
received. A second list of the same facts is how the first list goes stale.

**Radix renders only the active tab.** Referral Management was reported as
unsearchable. It can be searched, on two of its five tabs; the census was
standing on Overview measuring an empty DOM. Every tab is opened now and the
observations unioned.

**It read the weaker labelling pattern.** Vendor Enquiries was reported as
unsearchable. Its field carries a visible `<label for>` — the *right* way to
name an input — and the census read only `aria-label`, text and placeholder. An
instrument that rewards the weaker pattern pushes the product toward it.

And the one that mattered most: signing in fresh on each run earned a **429**
from the auth rate limiter, the cookie came back empty, every destination
redirected to `/auth` — and the census **passed all fifteen**, because "renders
real content" only asked whether the page was longer than 120 characters, and a
sign-in page is. It now uses the cached session that exists for this reason,
asserts the URL did not move, and aborts with the limiter's own message rather
than reporting the entire Admin surface as broken.
