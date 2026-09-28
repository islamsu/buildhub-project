# Finishing requests, quotation pricing strategies, and the AI context contract

Authoritative product behaviour for the current release. Referenced from
`CLAUDE.md` §90. Where this document and the code disagree, that is a defect in
one of them — not a licence to leave the requirement in a comment.

This document does **not** describe a new subsystem. Every rule below composes
architecture that already exists in the repository. The audit that established
that is recorded in §1 so a later reader can check the claim rather than trust
it.

---

## 1. The canonical architecture this builds on

Found by fresh audit before any code was written. **Reuse, never fork:**

| Concern | Canonical home | Status |
|---|---|---|
| Request record | `rfqs` — `marketCode`, `currency`, `category`, `budget`, `location`, `deadline`, `attachments`, `status` | exists |
| Request lines | `rfqItems` — quantity / unit / specifications, snapshotted | exists |
| Quotation record | `quotations` — `price`, `currency`, `timeline`, `warranty`, `paymentTerms`, `commercialTerms`, `validUntil`, `attachments`, `revisionNumber`, `supersededAt` | exists |
| Lifecycle | `rfq.create` → `list`/`eligible` → `openEnquiry` / `inviteSupplier` → `submitQuotation` → revision → `withdrawQuotation` → `acceptQuotation` / `rejectQuotation` → `status: awarded` | exists |
| Request category vocabulary | `shared/rfqCategories.ts` — nine values; `Renovation` = **تشطيب وترميم** | exists |
| Pricing-basis vocabulary | `shared/serviceCatalogue.ts` — `SERVICE_PRICING_BASES` | exists |
| Money formatting | `shared/money.ts` — `formatMoney`, currency from the record | exists |
| Markets / currency / scale | `shared/markets.ts` — `enabled` is the only launch switch; `CURRENCY_FRACTION_DIGITS` | exists |
| Authorization | `getRfqResponseAccess`, `requireProjectAccess`, `approvedProviderProcedure`, storage-proxy prefix rules | exists |
| AI grounding | server-owned system prompt, `detectIntent`, semantic retrieval, attachment re-authorization, project-context selector, `shared/aiRoles.ts` | exists |

**Gaps this document closes**, also established by audit:

1. Clicking an AI suggestion **auto-submitted it as a user message** —
   `AIChatBox.tsx` (`onClick={() => onSendMessage(prompt)}`) and
   `AIAssistantPage.tsx` (`onClick={… handleSend(t(mode.promptKey))}`).
   Suggestions were six fixed strings: role-blind, stage-blind, object-blind.
2. A quotation had exactly one number and no stated pricing method.
3. No quotation line items — `rfqItems` is the **request** side only.
4. No VAT, discount, contingency or overhead anywhere in the product.
5. No cross-method quotation comparison.
6. No structured finishing brief, and no way to say *I don't know*.
7. No way for a requester to express a pricing preference.

---

## 2. The AI click contract

### 2.1 A click establishes context. It never asks a question.

When a user clicks a service, category, request, quotation, provider, BOQ item,
project object or any AI affordance, that click sets the **selected subject**
and nothing else.

The assistant then offers suggested questions and actions **and waits**.

Binding rules:

- **No generated text may enter the conversation as a `user` message** unless
  the person explicitly submitted it.
- **No suggestion may auto-submit.** Choosing one places its text in the
  composer, editable, focused. Sending is a separate, deliberate act.
- A suggestion whose action is a route navigates; it does not ask anything.
- The assistant's own greeting and answers are `assistant` messages and are
  never relabelled as the user's.

This is a **product-integrity** rule, not a UX preference: a fabricated question
attributed to the user becomes indistinguishable from a real one in the
transcript, and every later answer is then grounded on something nobody asked.

### 2.2 Suggestions are derived from canonical context

`shared/aiSuggestions.ts` derives suggestions from:

| Input | Source |
|---|---|
| selected object + id | client selector, re-authorized server-side |
| object subtype / service | the object's own canonical fields |
| authenticated role / party | **session only** — never a request field |
| workflow stage / status | the object's canonical status |
| permissions | the same guards the object's own reads use |
| available object data | only fields the viewer is already allowed to read |

Suggestions **must** therefore differ by context. Worked examples that the
tests assert:

- A **homeowner** opening تشطيب sees: إنشاء طلب تشطيب, ساعدني في تحديد مستوى
  التشطيب, تقدير الميزانية, شرح خيارات التشطيب.
- A **contractor** opening that same published request sees: إعداد عرض سعر,
  تحديد المعلومات الناقصة, طلب توضيح, حساب السعر, إنشاء باقة.
- Once quotations exist, the **homeowner's** suggestions change to: قارن
  العروض, ما البنود غير المشمولة؟, اشرح فرق الأسعار.

Conversational context is preserved, so *"compare them"*, *"make this cheaper"*
and *"what is excluded?"* resolve against the selected subject.

### 2.3 AI context obeys the authorization boundary

A field being present on the server object is **not** a reason to send it to the
model. The AI context for an object is built from the **viewer's permitted
projection** of that object, the same one the viewer's own read returns. A
provider browsing the lead directory does not get budget or owner identity in an
AI context merely because the row has them.

---

## 3. Finishing requests are first-class, for every requesting party

`طلب تشطيب / Finishing Request` is an `rfqs` row — **not** a second request
type. It carries a structured **finishing brief** and reuses the canonical
category (`Renovation` / تشطيب وترميم), market, currency, lifecycle, attachments
and authorization.

### 3.1 Requesting parties

The existing account and relationship model already represents these actors.
**No second identity taxonomy is introduced.** A finishing request is valid from
a homeowner/property owner, a developer, a consultant, a main contractor, a
subcontractor, a property manager, and an organization account — each through
the role and relationship rows they already have.

### 3.2 A homeowner needs no construction knowledge

Progressive disclosure, plain language, and a genuine escape hatch:

Captured where relevant and known: finishing kind (full / partial / renovation /
specific-area); property or project type; location; approximate area; current
condition; rooms or areas; requested scope; desired finishing level; material or
brand preferences; budget or range; target timing; drawings; photos;
specifications; site constraints; special requirements.

**`لا أعرف / ساعدني في الاختيار` — "I don't know / help me choose"** is a
first-class stored state for every field that is not genuinely mandatory.

- It **never blocks publication**.
- It is **never silently replaced with a value**. It persists as the explicit
  `unknown` sentinel, and a reader sees *not stated*, not a guess.
- It **triggers explanatory suggestions** for that specific field.

Professional parties may be shown the denser technical workflow their role
already affords. The same record underlies both.

### 3.3 Pricing preference, not pricing homework

A finishing request may state a preference: `percentage`, `package`,
`detailed`, or **`دع المقاول يقترح طريقة التسعير` / let the contractor propose**.

- It is a **preference**, never a gate. Publication never requires it; unstated
  is a legitimate, persisted state distinct from *provider_choice*.
- A contractor may propose a different method when the request permits it
  (unstated or `provider_choice` permit any; a stated method is a constraint the
  server enforces).

---

## 4. The three finishing pricing strategies

These are **pricing strategies inside the canonical quotation**, not three
quotation systems. Existing generic/custom quotation behaviour remains available
and is the default for every request that is not priced by one of these.

`shared/quotationPricing.ts` owns the vocabulary and the arithmetic.

### 4.1 Percentage of applicable material cost — نسبة من تكلفة المواد

```
base = applicable material cost × agreed percentage
```

- The **percentage** and its **calculation basis** are both persisted. A total
  whose percentage is not stored is not reconstructable and is refused.
- The quotation must **disclose which material values participate** in the base,
  and any exclusions.
- **VAT, discounts, contingency, overhead/markup and unrelated charges never
  enter the base** and are never counted twice.
- **The percentage is QUOTATION-LEVEL. There is no per-trade percentage
  table, and that is the decided contract, not a gap.** A quotation carries one
  `percentageRate` against one `materialBaseAmount`; which trades that base
  covers, and which are excluded from it, is what the required
  `percentageBasisNote` states. A contractor who needs genuinely different rates
  per trade uses the **detailed/BOQ** method, where `quotationItems.tradeGroup`
  gives every line its own trade and its own rate. Two mechanisms for
  trade-level pricing would be two answers to what the job costs, which §5
  exists to prevent.
- Recalculation after a material change is **deterministic and
  server-authoritative**.

### 4.2 Package pricing — باقة تشطيب

- Tiers: Economy/اقتصادي, Standard/متوسط, Premium/فاخر, Luxury/فاخر جداً, and
  custom. These are **canonical suggestions, not a closed set** — a
  contractor-defined tier is valid and stored as given.
- Basis: any canonical `SERVICE_PRICING_BASES` value —
  per square metre, per unit, per day, per linear metre, or fixed project.
- Persisted: rate, basis, applicable area/quantity, scope, included trades,
  material level/allowances, brands/specifications, labour inclusion,
  exclusions, optional upgrades, duration, payment milestones, assumptions, VAT
  treatment, validity.
- **A displayed package total is always traceable to its stored basis.** A
  fixed-project package stores its amount as the rate with quantity 1; a
  per-unit package stores rate and quantity. No package total is persisted that
  its own inputs cannot reproduce.

### 4.3 Detailed / itemized — تسعير تفصيلي / BOQ

- Canonical quantity / unit / rate lines in `quotationItems`.
- Component types: material, labour, equipment, subcontract, other — legitimate
  direct-cost components only.
- Trade/category grouping is preserved and is the grouping shown to a reader.
- The line total is `quantity × rate`; the base is their sum. **No second BOQ
  calculator exists** — this is the only one, and the request side (`rfqItems`)
  is not duplicated into it.

---

## 5. One authoritative calculation path

`computeQuotationTotals()` in `shared/quotationPricing.ts` is the **only**
implementation of the arithmetic below. The server calls it and persists the
result. The client may call the same pure function to preview a total it has not
yet submitted, and **may never persist or transmit a total of its own** — a
client figure is never read back as truth.

```
base            method-specific (§4)
discountedBase  = base − discountAmount          (discount can never exceed base)
contingency     = discountedBase × contingencyRate / 100
overhead        = discountedBase × overheadRate  / 100
netBeforeVat    = discountedBase + contingency + overhead
vatAmount       = netBeforeVat  × vatRate / 100   (0 when vatRate is NULL)
total           = netBeforeVat  + vatAmount
```

`discountAmount` is an amount; `contingencyRate`, `overheadRate` and `vatRate`
are percentages. Each is one column, so no figure can be stated two ways and
disagree with itself.

Binding rules:

- **Contingency and overhead are each computed on `base − discount`.** They do
  not compound with one another, and neither is charged on VAT.
- **A discount can never exceed the base.** A negative net is a data-entry
  error, not a price, and it must not propagate into VAT and the total.
- **VAT applies once**, to `netBeforeVat`, and never to itself.
- **`vatRate` unstated is `NULL`, not `0`.** "No VAT rate was given" and "the
  VAT rate is zero" are different commercial statements and render differently.
- Every component is rounded to the **currency's own fraction digits**
  (`fractionDigitsFor`, which returns `null` rather than guessing) and the total
  is the sum of the rounded components — so a displayed total always equals the
  sum of its displayed parts.
- **`quotations.price` remains the single authoritative payable total.** No
  second total column exists. The invariant, enforced server-side and asserted
  by test, is `price === computeQuotationTotals(components).total`.
- Currency is **never** a quotation input. It is the RFQ's currency, as it
  already was.

---

## 6. Quotations stay comparable across methods

Every quotation, whatever its method, normalizes to one shape:
base/cost basis, inclusions, exclusions, allowances, optional upgrades,
discount, contingency, overhead, VAT, final payable, duration, validity,
payment milestones, assumptions.

`normalizeForComparison()` produces that shape, adding a **calculable rate per
unit area** only where an area is genuinely known — from a package quantity on a
per-square-metre basis, or from the request's stated area. Where area is
unknown, the rate is **omitted**, never inferred.

Comparison rules:

- Missing information renders as **missing/unknown**. It is never inferred, and
  never rendered as zero.
- Factual scope differences may be surfaced — *"Kitchen cabinets are included in
  quotation B and excluded from quotation A."*
- **Equivalence is never fabricated where scopes differ.** Two quotations whose
  inclusion sets differ are reported as differing, not reconciled.

---

## 7. Lifecycle

Finishing uses the existing states and transitions end to end:

```
draft / request details → publish → eligible providers receive / view
  → clarification → quotation → revision → comparison
  → acceptance / award → downstream project behaviour
```

**No finishing-only state machine.** `rfqs.status` (`open`/`closed`/`awarded`)
and `quotations.status` (`pending`/`accepted`/`rejected`/`withdrawn`), the
revision model (`revisionNumber`, `supersededAt`) and the existing notification
and audit paths are reused unchanged.

---

## 8. Money, VAT and market safety

- The canonical money model and formatter are used everywhere. No new money
  string is composed by hand.
- **SAR is not hard-coded.** Saudi Arabia is present in `shared/markets.ts` with
  `enabled: false`, and `enabled` remains the only thing that decides. A
  package priced "per square metre" is denominated in **the RFQ's currency**,
  whatever market that is.
- Every persisted monetary value retains its denomination, inherited from the
  RFQ.
- New money columns carry `MAX_CURRENCY_FRACTION_DIGITS` scale so a
  three-decimal currency (KWD, BHD, OMR) is representable before its market is
  ever enabled. `quotations.price` is widened to match — a lossless widening,
  verified against populated data.

---

## 9. Authorization and privacy

Everything above is subject to the existing rules, unchanged:

- Request, attachment, clarification, quotation, commercial and contact data are
  visible only to parties the canonical relationship rules already permit.
- A provider sees their own quotation, never a rival's.
- Quotation line items inherit the quotation's authorization exactly.
- AI context is built from the viewer's permitted projection (§2.3).
- Not-found and not-yours stay indistinguishable where they already are.

Negative tests for cross-party leakage are a release requirement, not optional
coverage.

---

## 10. Change discipline

Additive migrations, honestly backfilled. Where a historical row's pricing
semantics or denomination **cannot be proven**, no value is invented: existing
quotations are backfilled as method `custom` with their existing `price` as the
stated total and every new component `NULL`/zero, because that is exactly what
is known about them and nothing more.

---

## 11. What implementation found, and what is deferred

Recorded here rather than in a commit message, because both are things a later
reader needs.

### Two defects the end-to-end probe caught that the type system could not

1. **A `json` column comes back as a string.** `mysql2` hands drizzle the raw
   text, so `row.scopeDetail as Scope` compiled, read `.inclusions` off a
   string, got `undefined`, and produced a comparison with **no differences at
   all** — which looks exactly like two quotations that happen to agree.
   `parseJsonColumn` now parses defensively and returns null rather than
   throwing. The same bug was live for `finishingBrief`, so a stated area was
   being ignored.
2. **The suggestions endpoint was an id oracle.** The visibility check read
   `access !== null`, and `getRfqResponseAccess` never returns null — it answers
   `canRespond: false` for anybody. Every signed-in account that named a real
   request id got the request-shaped suggestion list back and learned the
   request existed. Visibility is now the rule the product already applies to
   its own request board: the requester, or an approved provider on an **open**
   request. An unresolved id falls back to `general` with no id.

Both are mutation-tested: compounding overhead on contingency, coercing an
unstated VAT rate to zero, and letting a rival open the comparison are each
caught by the probe.

### The owner-found release blocker, and what it exposed

**The Post RFQ dialog could not be scrolled.** `DialogContent` is `fixed`,
centred with a translate, and carried **no maximum height and no overflow at
all**. A dialog taller than the viewport ran off both edges, and because it is
fixed the page behind it could not be scrolled to reach the rest. Selecting
تشطيب renders the finishing brief, the form outgrew the screen, and the
remaining fields and the submit button became unreachable — so a finishing
request could not be published at all.

Measured on the real page with the bound removed: `top -756` to `bottom 1357`
in a 600px viewport, submit at `top 1296`. At an ordinary **1440×900** it was
`top -606` to `bottom 1507` — this was never only a short-screen bug; a 1080p
screenshot simply hid it.

Four of the product's thirty-seven dialogs had already hand-patched
`max-h-[90vh] overflow-y-auto` onto themselves. **The fix is therefore shared,
not local**: `DialogContent` is bounded with `max-h-[calc(100dvh-2rem)]`
(`dvh`, not `vh`, so the mobile keyboard is accounted for) and scrolls by
default, and a new `DialogBody` gives long forms the header / scrolling body /
reachable actions shape with exactly one scroll container.

Two layout causes sat beside it, both in the finishing brief:
`Button` is `whitespace-nowrap shrink-0`, so the long
`لا أعرف / ساعدني في الاختيار` chip could neither wrap nor shrink and pushed its
row sideways; and the two-column pairs used `sm:grid-cols-2`, which asks about
the **viewport** — inside a `max-w-lg` dialog on a 1440px desktop that condition
is satisfied, so two columns were rendered into ~230px each however much screen
there was. Chips now wrap with a real touch target; the pairs use a
**container** query against the dialog's own width.

### The finishing brief was write-only

Stored on create and returned by nothing. The requester could not reopen what
they had written, and the contractor pricing the job could not see the property
type, the area, the finishing level, or which questions the customer had said
they did not know — most of what a finishing quotation depends on. It is now
returned by `rfq.summary` **and** `rfq.list`, which must carry the same
allowlist or `summary` becomes a way around the feed's narrowing, and rendered
to both parties with unknowns shown **as** unknowns.

### Deferred, with reasons

- **The composer-fill path is proved at source level, not in a browser.** This
  environment has no AI credential, so `auth.capabilities.aiAssistant` is false
  and the tool cards are correctly inert. The probe **skips** that assertion and
  proves the stronger half instead — that a click appends no user message and
  raises no error. It is a real infrastructure skip, not a pass.
- **Per-trade percentages: decided, not deferred.** See §4.1. The percentage
  method is quotation-level by contract; trade-level rates are the BOQ's job.
  The earlier wording here read as a deferral of something promised elsewhere,
  which was the mismatch: §4.1 said "whole-scope or per-trade percentages are
  supported" while the schema has one percentage per quotation and the form
  offers one. The claim is gone, the contract is stated, and the quotation form
  now says the same thing where a contractor would otherwise go looking for a
  per-trade table.
- **Staging verification** remains blocked by the environment's network policy,
  unchanged by this work.
