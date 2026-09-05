# BuildHub — session handover

**Branch:** `claude/buildhub-audit-verification-vrai7l`
**HEAD:** `9163830`
**Gate at HEAD:** 3765/3765 vitest across 174 files · `tsc --noEmit` clean · `npm run build` clean
**PR #42 is open and unmerged.** I do not have merge authority. It now carries five
milestones beyond its stated scope.

---

## What shipped this session

| SHA | Milestone |
|---|---|
| `bf0f2af` | **DSP-6** — the admin dispute queue: paged, filtered, and no longer reading every user into memory |
| `cd64bc9` | **DSP-7** — the user-facing `/disputes` surface, which did not exist |
| `9f0322a` | **DSP-8** — the dispute negative matrix, proven against a real rival bidder |
| `38fe4d9` | **SWEEP-1** — every procedure wired, deleted or declared, with a guard |
| `9163830` | **LIST-1** — one pager for every administration list, with a guard |

**P2-DSP is complete** — all eleven items of the plan's §2.1–2.11.

### The defects these closed

- **A dispute list users could not read.** `disputes.myDisputes` had no client caller and
  there was no `/disputes` route, while the notification a respondent receives links to
  `/disputes/:id`. Being named in a dispute meant being told about a page that was not there.
- **A support queue that read the whole user table** to resolve two names per row, returned
  every dispute ever filed, and left search to the browser.
- **Silent truncation, five more times.** `products`, `projects`, `placements`,
  `vendorNameChanges` and `marketplaceProducts` each read 250 (or 200) rows with no count,
  each with a client that searched that array. A search matching row 251 answered "no
  results" with the confidence of a correct answer.
- **Unescaped LIKE patterns in six places**, including one that predates this session:
  an administrator searching the enquiry list for `%` matched every row.
- **Twenty procedures with no client caller**, among them a referral campaign form that
  meant campaigns could only be created with SQL, and the whole `audit` namespace.

---

## Three guards now stop the classes, not just the instances

Each computes the truth from source on every run and fails on a new instance. Each was
mutation-tested; each needed a correction before its silence was worth trusting.

| Guard | What it stops | The correction it needed |
|---|---|---|
| `server/reachability.test.ts` | A procedure with no caller that is neither deleted nor declared | It counted files nothing imports, so deleting a component's only use still read as "called". It now walks the import graph from `App.tsx`. |
| `server/adminList.test.ts` | A list read with a large fixed limit, no offset and no total | It read comments as code, and bounded procedure bodies by "until the next thing that looks like a procedure" — five false positives. |
| `server/searchInputHardening.test.ts` | A LIKE pattern built by hand | It named two files. Search had since moved into services, so three files' worth of the defect went unseen. |

The declared exemptions in `server/reachability.ts` and `adminList.test.ts` each carry a
reason and what would change it. Both guards fail if a declaration goes stale.

---

## Blocked by infrastructure — reported, never converted to a pass

- **Object storage.** No S3 and no Forge on this environment, so `disputes.addEvidence`
  refuses correctly. Seven checks across the dispute probes are recorded as
  `BLOCKED BY INFRASTRUCTURE`. The evidence rules have unit coverage and the storage
  proxy's canaries; the end-to-end proof needs S3 on staging.
- **SMTP.** No mail has ever been sent (`server/_core/mailer.ts`).
- **The payment provider.** Owner-deferred. Five procedures exist for a provider's webhook
  writes and reconciliation and are declared unreachable for that reason — wiring a button
  to any of them would record revenue BuildHub never received.

---

## One decision left open deliberately

`marketplace.featuredVendors`, `marketplace.sponsoredVendors` and
`marketplace.featuredProviders` are three public readers of the placement strip. The live
pages use the latter two. The first is pinned by `featuredPlacement.test.ts §5` and is
backed by a genuinely different function, not an alias. Deciding which survives has
commercial consequences, so it is declared in `server/reachability.ts` with that reasoning
rather than folded into a sweep. **This is yours to decide.**

---

## What remains, in the plan's order

1. **PM-A5 / PM-A6** — tests and the live scenarios for the project-team and RFQ-invitation
   work (PM-A4's UI is done; `rfq.declineInvitation` was the last dead end and is now wired).
2. **Support Tickets** (`todo.md:433`) — genuinely absent: no table, no router, no UI.
   Zero references in the codebase. The largest single gap left.
3. **Reviews and reputation, product lifecycle and image management, RFQ basket
   persistence, messaging reconciliation, notification preferences** — `todo.md:434–476`.
4. **Quotation revision model** (`server/routers.ts:3627`, marked KNOWN GAP) — duplicate
   bids are unprevented and re-notify each time. This touches a recorded owner decision;
   it should be implemented as the todo specifies, and anything that would reverse that
   decision flagged rather than decided.
5. **ACC-4** — final cross-role acceptance.

`todo.md` stands at 53 unchecked and 324 checked.

**Not on this list, because it is done:** the raw-ID rendering item. What remains in the
admin screens is `name ?? #id` — a name when there is one, an id when there is not, which
is the correct pattern rather than the raw-ID-first workflow the plan objected to.

---

## Running the verification

```bash
service mariadb start
set -a && . scratchpad/journeys.env.prelaunch && set +a
setsid nohup npx tsx server/_core/index.ts > /tmp/server.log 2>&1 &

node evidence/zg-disputequeue.mjs    # 48/48   the support queue
node evidence/zg-disputeuser.mjs     # 118/118 the user surface, 375/768/1440 in EN and AR
node evidence/zg-disputematrix.mjs   # 48/48   the negative matrix
node evidence/zg-adminlists.mjs      # 33/33   the paged administration lists
```

Every probe cleans up after itself and proves the cleanup. Two things worth knowing before
trusting a run:

- **The server does not hot-reload.** `tsx` needs a restart after any `server/*.ts` change.
  A probe passing against a stale server has bitten this project more than once — check the
  process start time against the file mtime.
- **Vite runs in dev mode here**, so a route's module graph compiles on first request.
  Browser probes warm through `/` first and wait on the element they assert, not on `body`.

---

## Standing rules I held to

No test was weakened to go green. Where an existing test broke, it was restated against the
behaviour that replaced it — thirteen times this session, each with the reasoning written
at the test. Every new guard was mutation-tested, and three times a mutation survived and
forced the test to be strengthened rather than the pass accepted. No fabricated data
anywhere; zero rows produce a truthful empty state. Authorization is enforced server-side,
and the probes prove the refusals rather than describing them.

Where my own instruments were wrong I fixed the instrument, not the reading: the
reachability census had both a false positive and a false negative, the truncation census
read prose as code, and the dispute probes were leaving orphaned audit rows that the new
audit screen exposed.
