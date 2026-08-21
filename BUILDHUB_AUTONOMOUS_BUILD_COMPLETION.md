# BuildHub — Autonomous Build Completion Report

**Branch:** `claude/phase4b-readiness-audit-hardening` (also pushed to `claude/buildhub-audit-verification-vrai7l`)
**Head:** `2077dee` · **Base:** `main` at `71d891f`, untouched
**Gate:** 964 tests across 49 files · `tsc --noEmit` clean · client and server builds green

---

## What this covers

Nine slices, each independently verified against a real MariaDB instance and — where
there was a user-facing surface — a real Chromium session in English and Arabic at
1440px and 375px. Every slice was committed and pushed separately.

| Slice | Commit | What it did |
|---|---|---|
| 1 | `472e3b4` | Critical production hardening (A1–A9 from the readiness audit) |
| 2 | `91a4fea` | Made the billing system reachable |
| — | `b5d0ed2` | Vultr infrastructure architecture (report only) |
| 3 | `1801fbe` | First-party email + password authentication |
| 4 | `9229f50` | Deployability, security headers, and two dishonest surfaces |
| 5 | `be5728a` | Portable object storage; dead Manus scaffold removed |
| 6 | `1063448` | CI, a deployable image, a deploy pipeline that cannot fire by accident |
| 7 | `41cb5e8` | Product analytics event stream and commercial KPIs |
| 8 | `b9c6ee7` | Featured placement as a separate, labelled, paid capability |
| 9 | `2077dee` | Authorization sweep across the six unswept routers |

---

## The launch blocker, resolved

**Before:** real users could not sign in without `OAUTH_SERVER_URL`, a Manus-platform
service. `auth.signInDummy` accepts only `isDummy = true` accounts. On infrastructure
you control, with Manus gone, **nobody could log in.** Classification: **C — migration
required.**

**Now:** first-party email + password authentication, built on primitives that already
existed — scrypt hashing, the `passwordHash` column, the session JWT, the cookie
helper, the audit-event table. The OAuth callback is untouched and still works wherever
`OAUTH_SERVER_URL` is reachable; it is simply no longer the only door.

This also closed a pre-existing dead end: admin-created accounts could set a password
through the invitation flow and then had no endpoint that would accept it.

Password reset invalidates every existing session — `users.sessionsInvalidBefore`
checked against the token's `iat`, because the whole point of a reset is that someone
else may hold a live session.

**Email delivery is the one thing still requiring you.** It sits behind a `Mailer`
adapter that mirrors the payment-provider seam: the default `NullMailer` throws rather
than pretending, and `auth.capabilities` tells the UI whether reset is offerable, so
nothing ever displays "check your inbox" when no message was sent.

---

## Defects found and fixed along the way

Each was found by probing the running system, not by reading prior reports.

**`rfq.list` was public.** It returned every column of the 50 most recent RFQs — including
`budget`, the homeowner's private figure — to anyone on the internet with no account.
`rfq.get` beside it had always been protected. One procedure missed when its neighbour
was hardened.

**All five upload endpoints trusted the client's declared content type** and never looked
at the bytes. `image/svg+xml` satisfies every `startsWith('image/')` check in the
codebase while being a scriptable XML document. Now magic-byte sniffed, with SVG, HTML
and XML refused outright.

**`messages.send` accepted any quotation id that existed**, making the "Quote ID" box an
oracle for enumerating the marketplace's bids. Now the sender must be a party, and a
stranger gets the same `NOT_FOUND` as a nonexistent id.

**`marketplace.get` served withdrawn products.** `list` filtered `active`; `get` did not.

**`marketplace.questions` leaked `askerId`** from a public endpoint via a bare select.

**The admin dashboard invented its own growth chart.** `MONTHLY_USERS` — 120, 180, 250,
310, 420, 580 — rendered whenever real aggregates were empty. Removed; and once removed,
`analyticsSummary`'s hardcoded `'2026-07'` fallback label became visible and was removed
too.

**`billing.plans` decided entitlement availability with a denylist.** Rewording one
marker in Slice 8 silently flipped `visibilityLevel` to "available" — advertising, on
the pricing page, a capability nothing enforces. Replaced with an allowlist that fails
closed.

**`messages.uploadAttachment` mangled every filename.** `[^\\w.-]` — a double backslash
inside a regex literal — made the negated set `{backslash, w, dot, hyphen}`, so
`site-plan.pdf` became `_-_._`.

---

## Two commercial decisions worth your attention

**Featured placement is a separate sponsored strip, not a reordering.** Phase 4B.3 §13
established that a paid plan must never buy a higher organic position. Featured vendors
appear in their own labelled section *and* still appear in the organic list in their
organic position — removing them would have been a hidden penalty for paying. Slots
rotate daily so the earliest subscriber cannot own the strip permanently.

**`visibilityLevel` (boosted/top) is deliberately still not enforced.** It would buy
position *inside* the organic ranking, which is what §13 forbids. Reversing that is your
decision, not something to infer from a plan table. Its ledger entry now says so.

**Four of nine entitlements remain unbuilt** (`portfolioLevel`, `promotionalCapability`,
`branchLimit`, `teamMemberLimit`). The pricing page badges them "coming soon" rather
than advertising them.

---

## Analytics: two sources of truth, deliberately separate

The **funnel** comes from the new `analyticsEvents` table — eight stages from
registration to subscription. The **money** comes from `vendorSubscriptions`, priced by
`resolvePrice` from `shared/billing.ts`, never from the event stream: a stream is
allowed to drop a write, and revenue reporting cannot be built on something lossy.

Three properties the KPI code is built around, each verified live:

- A trial contributes **zero** to MRR.
- Revenue is time-derived, so a row still marked `active` whose period ended contributes
  nothing however far behind the lifecycle sweep is.
- Empty means **null**, not zero. ARPV and churn return null with no basis, and the
  dashboard renders an em dash. "0% churn" reads as perfect retention.

---

## What still requires you

Nothing below is blocked by code. Each needs an account, a credential, or a decision.

1. **Email provider** — pick one and register an adapter. Password reset and email
   verification are built and inert until then.
2. **Paymob** — still externally blocked. No provider behaviour has been invented; the
   adapter interface is shaped from BuildHub's own lifecycle, and `NullPaymentProvider`
   refuses loudly. Self-service checkout does not exist and the pricing page says so.
3. **Vultr provisioning** — compute, Managed MySQL, Object Storage, firewall, DNS,
   TLS, backups. The architecture report (`b5d0ed2`) classifies all 22 items. Vultr is
   unreachable from this sandbox, so the Egypt region recommendation is a procedure for
   you to run, not a fabricated measurement.
4. **GitHub secrets and environment approval** — the three workflows are authored and
   reviewed; production deploy is gated behind a GitHub environment approval and cannot
   fire from a feature branch. No secret is committed.
5. **Object-storage credentials** — the S3 adapter is written and selected by env var;
   Vultr Object Storage is S3-compatible.

---

## Boundaries held throughout

No secrets committed. No Paymob behaviour invented. No price changed. No production
infrastructure created, no DNS touched, no deploy executed, nothing exposed publicly.
`main` and every Phase 4A/4B branch untouched. No user or vendor data destroyed —
all 19 migrations are additive, and every verification run tore its fixtures back down
to the exact baseline. `project.spent` semantics not redefined.
