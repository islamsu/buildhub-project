# BuildHub — Phase 4B.5
## Paymob Sandbox Integration & Provider Synchronization

# ⛔ NOT READY — PROVIDER BLOCKER

**No integration code was written. No adapter exists. No provider response was
fabricated. No credential was created.**

Phase 4B.5 requires a real Paymob sandbox/test merchant account. This
environment has neither the credentials nor network access to Paymob. Per the
brief §2 and §21, this phase stopped at verification and produced this report
instead of implementing a pretend integration.

---

## 1. Baseline SHA

| | |
|---|---|
| **Baseline SHA** | `54918a2eab548d5d1db60fda7c0fc95f9316539c` |
| **Baseline branch** | `claude/phase4b4-subscription-lifecycle` |
| **Verified** | 2026-08-20 |

## 2. Branch

`claude/phase4b5-paymob-integration`, created from the baseline above.

Contains **this report only**. No source file was modified.

### Baseline integrity — verified independently

| Branch | Tip | Status |
|---|---|---|
| `main` | `71d891f` | **untouched** |
| `claude/phase4b1-billing-domain-foundation` | `cfb1553` | untouched |
| `claude/phase4b2-plan-entitlement-engine` | `bbf4dd4` | untouched |
| `claude/phase4b3-vendor-directory-targeting` | `5258035` | untouched |
| `claude/phase4b4-subscription-lifecycle` | `54918a2` | untouched |
| All 20 Phase 4A branches | — | untouched |

Phase 4B modules all present and intact:

```
shared/billing.ts               218 lines    server/billing/enquiries.ts   239 lines
server/billing/domain.ts        529 lines    server/billing/lifecycle.ts   528 lines
server/billing/service.ts       204 lines    server/vendorDirectory.ts     179 lines
server/billing/entitlements.ts  241 lines    shared/rfqCategories.ts        70 lines
server/billing/provider.ts      143 lines
```

Full suite **598/598 passing**, TypeScript clean, at baseline and unchanged.

---

## 3. Paymob Account Readiness — **BLOCKED**

Two independent hard blockers. Either alone stops Phase 4B.5; both are present.

### BLOCKER 1 — No Paymob credentials exist in this environment

Every location a credential could live was checked. All empty:

| Checked | Result |
|---|---|
| Process environment (`paymob`, `payment`, `merchant`, `hmac`, `integration_id`, `iframe`) | **no matches** |
| Process environment, all keys matching `pay`/`mob`/`secret`/`key`/`token`/`merchant` | only harness tokens: `GH_TOKEN`, `GITHUB_TOKEN`, `AWS_*`, `CLAUDE_*`, `CLOUDSDK_*` — **nothing Paymob** |
| `.env`, `.env.local`, `.env.*` in project root | **no .env files exist** |
| `find . -name ".env*"` across the whole repo | **none** |
| `.env.example` / `.env.sample` / `.env.template` | **none exist** |
| `~/.aws/credentials`, `~/.config/paymob`, `/run/secrets`, `/var/run/secrets` | **none exist** |
| `server/_core/env.ts` (the app's own config surface) | reads only `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` — **no payment config of any kind** |
| Repo-wide `grep -ril "paymob"` | 15 files, **all documentation or architecture prose** — zero credentials, zero adapter code |

### BLOCKER 2 — Paymob is unreachable from this environment

Outbound HTTPS is governed by an organization egress allowlist. Paymob is not on it.

```
https://accept.paymob.com/       → curl (56) CONNECT tunnel failed, 403
https://paymob.com/              → curl (56) CONNECT tunnel failed, 403
https://developers.paymob.com/   → blocked
https://docs.paymob.com/         → blocked
POST accept.paymob.com/api/auth/tokens → HTTP 000 (never reached the host)
```

Confirmed as **policy denial, not a transient failure**, from the proxy's own
status endpoint:

```json
"recentRelayFailures": [
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "accept.paymob.com:443" },
  { "kind": "connect_rejected", "host": "paymob.com:443" },
  { "kind": "connect_rejected", "host": "developers.paymob.com:443" },
  { "kind": "connect_rejected", "host": "docs.paymob.com:443" }
]
```

The block is an **allowlist**, not a Paymob-specific ban — permitted hosts
answer normally while non-allowlisted ones are rejected identically:

| Host | Result |
|---|---|
| `api.github.com` | 200 (allowlisted) |
| `registry.npmjs.org` | 200 (allowlisted) |
| `example.com` | rejected |
| `api.stripe.com` | rejected |
| `*.paymob.com` | rejected |

The environment's own operating guidance is explicit: *"do not retry
organization policy denials (403/407) — report them instead."* This report does
that.

> **Accuracy note.** `api.github.com/orgs/PaymobAccept` also returns 403 — but
> so does `api.github.com/orgs/anthropics`. That is a general restriction on
> raw GitHub API paths in this session, **not** a Paymob-specific signal, and it
> is reported as such rather than counted as a third blocker. The prior phase
> was able to fetch Paymob's GitHub-hosted documentation directly; this session
> cannot, so even the documentation-tier evidence cannot be independently
> refreshed here.

### Required prerequisites — none satisfied

Every item the brief §2 lists must be confirmed against a real account. **Zero
are available.** Nothing below is inferred, and no value is guessed:

| Prerequisite | Status |
|---|---|
| Test merchant account | ❌ not available |
| API credentials / API key | ❌ not available |
| Integration ID(s) | ❌ not available |
| iframe / payment integration configuration | ❌ not available |
| Authentication credentials | ❌ not available |
| HMAC / webhook secret | ❌ not available |
| Webhook delivery endpoint registration | ❌ not possible (no account, no egress) |
| Subscription functionality | ⚠️ documentation-tier only (prior phase); **not test-verified** |
| Tokenization | ⚠️ documentation-tier only; **not test-verified** |
| Recurring billing | ⚠️ documentation-tier only; **not test-verified** |
| Cancellation | ⚠️ documentation-tier only; **not test-verified** |
| Refund | ⚠️ documentation-tier only; **not test-verified** |
| Payment success / failure events | ⚠️ documentation-tier only; **not test-verified** |
| Transaction identifiers | ❌ unknown — no real payload has ever been observed |
| Subscription identifiers | ❌ unknown — no real payload has ever been observed |
| Billing-cycle information | ❌ unknown — no real subscription object observed |
| EGP settlement/payment currency | ⚠️ documentation-tier only; **not test-verified** |

No secret was printed, committed, or created anywhere in this phase.

---

## 4. Provider Capabilities Verified

**Test-account-verified capabilities: ZERO.**

The Phase 4B "Final Blocker Authorization" report previously established a
documentation-tier capability matrix (recurring billing, tokenization,
retry/dunning mechanism, cancellation, refunds, sandbox mode via test keys, EGP
support) sourced from Paymob's own published material. That matrix is carried
forward **as prior documentation evidence only** and is explicitly *not*
re-verified here — this session could not reach any Paymob domain, so it cannot
independently confirm or refresh a single item.

Critically, the details Phase 4B.5 actually needs are exactly the ones
documentation never settled and that only a live account can answer:

* the real webhook payload shape and event-type vocabulary,
* whether Paymob emits its own event id for deduplication,
* the exact HMAC computation input (field order and concatenation are
  provider-specific and **cannot be guessed** — a wrong implementation would
  either reject every genuine event or, far worse, accept forged ones),
* which fields a subscription object returns for current period / renewal date,
* the default retry cadence for failed payments,
* whether Paymob's cancellation semantics match BuildHub's "cancel at period
  end, keep access until then" policy (brief §11 requires STOPPING on a
  mismatch rather than inventing a workaround — that comparison cannot even be
  attempted without an account).

---

## 5–15. Implementation Sections — **NOT IMPLEMENTED**

The brief's sections 3–19 describe work that all depends, without exception, on
a working Paymob sandbox. None of it was built:

| § | Deliverable | Status |
|---|---|---|
| 5 | Provider abstraction | **Already exists from Phase 4B.1** — `server/billing/provider.ts` defines `PaymentProvider` with `createCustomer`, `createCheckoutSession`, `cancelSubscription`, `refund`, `verifyAndParseWebhook`, plus a `NormalisedProviderEvent` vocabulary. `NullPaymentProvider` throws loudly on every operation. **No Paymob adapter written.** |
| 6 | Payment initialization | ❌ not implemented |
| 7 | Subscription synchronization | ❌ not implemented |
| 8 | Webhook verification | ❌ not implemented — **see the security note below** |
| 9 | Idempotency (provider event ids) | ❌ not implemented |
| 10 | Amount / currency validation | ❌ not implemented |
| 11 | Ownership validation | ❌ not implemented |
| 12 | Cancellation sync | ❌ not implemented |
| 13 | Payment failure / grace sync | ❌ not implemented |
| 14 | Refunds | ❌ not implemented |
| 15 | Reconciliation | ❌ not implemented |

**Why no adapter was written even as a skeleton.** The brief forbids fabricated
provider responses and pretend integration. A Paymob adapter written without an
account would require inventing the HMAC signature construction, the event-type
names, and the payload field paths. Section 8 calls webhook verification
CRITICAL — and a *guessed* signature verifier is the single most dangerous
artifact this phase could produce, because it looks complete, passes its own
invented tests, and may accept forged payment events in production. Shipping
that would be worse than shipping nothing.

---

## 16. Security

No new attack surface was introduced, because no code was added. The relevant
security posture is what Phase 4B.4 already established and this phase leaves
intact:

* No payment endpoint exists, so unauthenticated payment initialization is not
  merely rejected — it is unreachable.
* Vendors cannot self-grant paid entitlements: plan selection is admin-only
  until checkout exists (Phase 4B.4 §14).
* `NullPaymentProvider` throws on every operation rather than silently
  no-opping, so no code path can quietly behave as though a payment succeeded.
* No credential was created, committed, printed, or logged in this phase.

The §19 security tests (invalid webhook rejected, replay safe, provider-ID
substitution rejected, cross-vendor event isolation) **cannot be written
honestly** without knowing the real signature scheme and payload shape. Writing
them against an invented scheme would produce tests that prove nothing while
appearing to prove everything.

---

## 17. Schema Changes

**None.** No migration was generated or applied.

Phase 4B.1 already provisioned the provider-agnostic columns a future adapter
will need, all nullable, with no card, CVV, token, or credential data anywhere:

```
vendorSubscriptions.provider                  varchar(40)
vendorSubscriptions.providerCustomerRef       varchar(191)
vendorSubscriptions.providerSubscriptionRef   varchar(191)
vendorSubscriptions.providerPriceRef          varchar(191)
billingEvents (audit trail, source: 'provider' already supported)
```

A provider **event/transaction** reference table for webhook idempotency (§9)
is still needed and was deliberately **not** created — its shape depends on
whether Paymob supplies its own event id, which is one of the unanswered
questions in §4.

---

## 18. Sandbox Test Evidence

**None. Zero sandbox tests were run.**

All seventeen scenarios the brief §20 lists (A–Q: Professional monthly, Premium
monthly, standard pricing, founder Professional, founder Premium, successful
payment, failed payment, recovery, cancellation, duplicate webhook, invalid
webhook, refund within window, refund outside window, reconciliation,
cross-vendor isolation, repeated delivery, renewal) require a real Paymob
sandbox. **Not one was performed, and not one is reported as performed.**

The brief's instruction — *"Do not fake these as 'live' tests"* — is the reason
this section is empty rather than populated.

---

## 19. Regression Results

The baseline was re-verified on the new branch before stopping:

| Gate | Result |
|---|---|
| Full test suite | **598 / 598 passed** (40 files) |
| TypeScript | clean |
| Phase 4A functionality | intact |
| Phase 4B.1 billing foundation | intact |
| Phase 4B.2 entitlement engine | intact |
| Phase 4B.3 directory / targeting / enquiries | intact |
| Phase 4B.4 subscription lifecycle | intact |
| Branch integrity | `main` and all phase branches untouched |
| Secrets committed | none |

Frontend and server builds were not re-run: no source file changed from a
baseline where both were already verified green.

---

## 20. Limitations

1. **No Paymob sandbox account** — the primary blocker. Unchanged since the
   Phase 4B Final Blocker Authorization report first raised it; no credentials
   have been provisioned since.
2. **No network egress to Paymob** — a second, independent blocker that did not
   exist in the same form previously. Even *with* credentials, this session
   could not complete a single API call. Both must be resolved together.
3. **Documentation cannot be refreshed** — all Paymob domains are blocked, so
   even the documentation-tier capability matrix cannot be independently
   re-confirmed in this session.
4. **HMAC scheme unknown** — the one detail that most needs primary-source
   confirmation, and the one it would be most dangerous to guess.

---

## 21. Unresolved Provider / Business Decisions

**Provider — blocking:**

1. Provision a **Paymob sandbox/test merchant account** and supply, via
   environment variables or a secret store (never in source): API key,
   integration ID(s), iframe ID if required, and the HMAC/webhook secret.
2. **Add Paymob to the environment's network allowlist**: `accept.paymob.com`,
   `paymob.com`, and the developer-documentation domains.
3. A publicly reachable **webhook endpoint** for the sandbox to deliver events
   to — this session is not addressable from the internet, so even a fully
   built integration could not receive a single webhook here.

**Business — carried forward, still open:**

4. **Refund policy (§12)** — a 7-day refund window on initial purchase is
   proposed but has **not** been confirmed as approved, and the brief itself
   requires flagging any customer-facing refund policy for business/legal
   review. Not implemented, not promised.
5. **Cancellation semantics mismatch** — whether Paymob's cancellation behaves
   as BuildHub requires is untested. Per §11 this must STOP rather than be
   worked around, so it stays an open question.
6. The five Phase 4B.4 owner decisions remain open (renewal-sync window,
   one-trial-per-vendor, founder annual handling, grace-period entitlements,
   proration policy).

---

## 22. Production Readiness Assessment

**BuildHub's own billing system is ready for a provider. The provider is not
available.**

What is genuinely ready, verified across 4B.1–4B.4:

* A provider-agnostic seam (`PaymentProvider`) that a Paymob adapter drops into
  without touching the billing domain.
* A subscription lifecycle that is serialised, idempotent, fail-closed and
  auditable, with transitions (`recordPaymentSucceeded`, `recordPaymentFailure`,
  `recordPaymentRecovery`) already shaped for a provider to drive — the exact
  functions Phase 4B.5 was going to connect.
* An entitlement engine that cannot over-grant, and that already fails closed on
  missing, stale, or malformed billing state.
* An audit trail with a `provider` source value already supported.

**Production readiness: NOT READY.** No payment can be collected. No vendor can
subscribe. This is unchanged from Phase 4B.4 and is not a regression.

**No payment security issue was found** — because no payment code exists. The
status below is deliberately *not* `CRITICAL`: nothing insecure was built. It is
a provider-availability blocker, exactly as the brief anticipated.

---

## Final Status

# NOT READY — PROVIDER BLOCKER

**Exact prerequisites to unblock Phase 4B.5:**

1. A real Paymob **sandbox/test merchant account**.
2. Its credentials supplied **via environment/secret store, never in source**:
   API key · integration ID(s) · iframe ID (if required) · HMAC/webhook secret.
3. **Network allowlist entries** for `accept.paymob.com`, `paymob.com`, and the
   Paymob developer-documentation domains.
4. A **publicly reachable webhook endpoint** the sandbox can deliver events to.

With all four in place, Phase 4B.5 can proceed against a real sandbox. Without
them, any adapter produced would be guesswork wearing the appearance of an
integration — and its webhook verifier, the one component the brief calls
CRITICAL, would be the most dangerous guess of all.

**STOP. No implementation performed. Awaiting Paymob sandbox access.**
