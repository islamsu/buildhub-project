# BuildHub — GCC Market, Regulatory, Compliance & Activation Readiness Report

**Prepared for owner review.** Verified against `f6d21be` on
`claude/buildhub-audit-verification-vrai7l`, 2026-10-01.

> This report does not enable a market, deploy production, or convert any
> research finding into a production requirement. Those are separate,
> owner-authorized steps (§36, §40, §65 of the directive).

---

## 1. Executive Summary

BuildHub operates in **one market: Egypt**. All six GCC markets exist in the
code as architecture and in the database as structure, and are commercially
inert.

### What Phases 0–3 changed

Before them BuildHub had no concept of a market that money and eligibility
could hang off. It had `'EGP'` written into eleven places, a free-text location
on every request, and — the finding that began this work — a quotation currency
taken from **the supplier's subscription plan**. A vendor operating in Oman had
an EGP listing because the platform had no other value to write.

Four phases replaced that with:

- money columns that can hold a three-decimal currency (KWD, BHD, OMR)
- every commercial write stating its own market or **refusing**
- provider approval that is **per-market** rather than global
- service offers priced **independently per market**
- work location as the single authority from which currency is derived

### Why GCC could not safely have been enabled before

Not because a flag was off — because flipping it would have produced **wrong
numbers in commercial documents**.

Three of the six GCC currencies divide into 1,000 minor units. MySQL does not
refuse an over-scaled insert; it rounds and carries on. An Omani quotation of
1,234.567 would have been stored as `1234.57` with the third digit **gone from
the database** — unrecoverable by any formatter fix.

Separately, seven code paths wrote Egypt onto new commercial records that
stated no market. An Omani project would have carried an EGP budget; a Saudi
request would have been quoted in Egyptian pounds.

### What remains

| Blocker | Class |
|---|---|
| Discovery is market-blind; the eligibility predicate has no callers | **ENGINEERING** (now build-gated) |
| Verified compliance requirements for all **seven** countries | **COMPLIANCE DATA** |
| Credential expiry not modelled | **ENGINEERING** |
| No admin surface for per-market approval | **ENGINEERING** |
| Egypt's requirement provenance unassigned | **PRODUCT DECISION** |
| Claude→staging connectivity | **DEPLOYMENT** |
| Finishing release website acceptance | **OWNER ACCEPTANCE** |
| GCC staging matrix, GCC website acceptance | **DEPLOYMENT / OWNER ACCEPTANCE** |
| Production activation authorization | **PRODUCTION OPERATIONS** |

### The distinctions this report rests on — each enforced in code

```
registered market     ≠  enabled market
enabled market        ≠  provider approved
provider approved     ≠  service offered
service offered       ≠  RFQ eligibility
account country       ≠  work country
provider country      ≠  transaction market
subscription currency ≠  service-offer currency ≠ RFQ/quotation currency
```

---

## 2. Verified Engineering Baseline

Verified by execution, not restated from conversation.

| Reported | Verified | Result |
|---|---|---|
| Phase 0 `e20653f` | ancestor of HEAD | ✅ |
| Phase 1 `89c7998` | ancestor of HEAD | ✅ |
| Phase 2 `61eb4fd` | ancestor of HEAD | ✅ |
| Phase 3 `87bd262` | ancestor of HEAD | ✅ |
| Compliance `5faf9e2` | ancestor of HEAD | ✅ |
| 67 migrations from empty | 67 journal entries, 67 `.sql`, 67 applied to a fresh DB | ✅ |
| 232 test files / 5196 tests | **233 files / 5204 tests** | ⚠ **discrepancy — see below** |
| typecheck green | exit 0 | ✅ |
| production build green | built at `f6d21be` | ✅ |
| local == remote | both `f6d21be` | ✅ |
| EG enabled, six GCC disabled | 1 enabled | ✅ |

### The one discrepancy

The reported figures (232 / 5196) were correct **at `5faf9e2`**. HEAD is
`f6d21be`, which added one test file and eight tests during report preparation:

- `server/discoveryMarketGate.test.ts` (5 tests) — the build gate for the
  market-blind discovery finding in §21
- three tests in `server/serviceOfferingMarkets.test.ts` — the §28 blank-country
  distinction

Both were added because the audit for this report surfaced findings that would
otherwise have made the report inaccurate, which the directive permits (§
"unless a source-independent defect makes the report itself inaccurate").

`main` is `cc4b1ed`. The frozen finishing RC `d4fa871c` is intact. Working tree
clean.

---

## 3. Architecture Map

| Concept | Where it lives | Authority |
|---|---|---|
| Provider legal country | `vendorProfiles.legalCountryCode` | ISO 3166-1 alpha-2, deliberately **wider** than market codes |
| Provider primary market | `vendorProfiles.primaryMarketCode` | single column — two primaries structurally impossible |
| Provider served markets + approval | `providerMarkets` | one row per market; 5-state status |
| Market-specific service offer | `serviceOfferingMarkets` | unique `(service, market)`; **no currency column** |
| Project market | `projects.marketCode` + `currency` | explicit at creation |
| RFQ market | `rfqs.marketCode` + `currency` | inherited from project, or explicit |
| Quotation currency | derived from `rfqs.currency` | provider cannot send one |
| Subscription currency | `vendorSubscriptions.currency` | `BILLING_CURRENCY` = EGP only |
| Market registry | `shared/markets.ts` | `enabled` is the only thing that decides |
| Implicit-market resolver | `resolveImplicitMarket()` | one enabled → resolve; zero or >1 → **refuse** |
| Eligibility predicate | `shared/marketEligibility.ts` | built, tested, **not yet called** |
| Compliance engine | `shared/complianceAuthority.ts` | provenance-carrying |
| Compliance data | `shared/complianceMarkets.ts` | all entries unverified |
| Project market change | `shared/projectMarketChange.ts` | dedicated lifecycle operation |

---

## 4. Regulatory Methodology

### Research limitation, stated before any claim

**No official page was read.** `WebFetch` is blocked for every domain in this
environment — government sites, `docs.github.com`, even `example.com`. Search
works and returns genuine titles and URLs, but its *summaries* blend ministry
pages with consultancy articles, which the directive excludes as authority
(§6).

The question that cannot be settled without reading the page is the one that
matters most: **applicability**. Whether a contractor classification conditions
all contracting work or only government tenders is the difference between a
reasonable onboarding and excluding most of a market for no legal reason.

Therefore every regulatory entry carries evidence status **OFFICIAL SOURCE
DISCOVERED — NOT YET READ** or **UNVERIFIED**. Nothing is marked verified —
not from search summaries, and not from model recall. Recall is not a source,
these rules change, and a plausible requirement asserted confidently is worse
than an absent one: the provider gathers the wrong papers and BuildHub looks
authoritative doing it.

### The layer model (§4 of the directive), as implemented

| Layer | Question | Representable today |
|---|---|---|
| A — Legal existence | Does this entity legally exist? | ✅ `type` + `authority` |
| B — Activity authorization | Is it authorized for this activity? | ✅ `activities[]` narrowing |
| C — Professional authorization | Is the individual authorized? | ✅ role-keyed |
| D — Contractor classification | Universal, graded, or conditional? | ✅ `applicability` + condition |
| E — Public procurement | Private work, or tenders only? | ✅ `public_procurement_only`, **opt-in** |
| F — BuildHub policy | Platform requirement, not law | ✅ `provenance: buildhub_policy` |
| G — Optional credential | Trust signal, not a blocker | ✅ `provenance: optional_credential` |

The pre-existing `ComplianceRequirement` could express **none** of this. Its
`required: boolean` collapsed the single most important distinction: "required
by law" and "required by BuildHub" were both `true`, so a provider reading the
screen could not tell which — meaning a BuildHub trust policy read as a legal
obligation.

### Evidence strength vocabulary (§49)

- **VERIFIED — DIRECT OFFICIAL SOURCE** — official page read and recorded.
  *Currently used: nowhere.*
- **PARTIALLY VERIFIED** — some aspects established. *Currently used: nowhere.*
- **OFFICIAL SOURCE DISCOVERED — NOT YET READ** — authority and URL identified.
- **UNVERIFIED** — not even an authority identified.
- **NOT APPLICABLE**.

---

## 5. Egypt — EG / EGP

| | |
|---|---|
| Market code / currency / fraction digits | EG / EGP / **2** |
| Registry state | registered, **enabled** |
| BuildHub enablement | **live and operating** |
| Technical readiness | ✅ complete |
| Compliance readiness | ❌ **configured but unevidenced** |
| Staging readiness | ❌ blocked |
| Owner acceptance | ❌ open (finishing release) |
| Production activation state | **live** (pre-dates this workstream) |

### Narrative

Egypt is not exempt from this audit and it does not pass it.

Egypt's requirements live in `shared/compliance.ts` as a hard-coded array with
**no authority, no official source and no verified date** — precisely the
unauditable shape the directive asks to replace. The array predates the
compliance architecture entirely.

### Evidence matrix

| Role | Configured slots (`*` = currently required) | Authority | Evidence |
|---|---|---|---|
| contractor | identity\*, tax_card\*, commercial_registration\*, professional_license\*, insurance_certificate | **none recorded** | **UNVERIFIED** |
| supplier | identity\*, tax_card\*, commercial_registration\*, bank_certificate\*, product_catalogue | **none recorded** | **UNVERIFIED** |
| engineer | identity\*, tax_card\*, professional_license\*, tax_registration\*, portfolio | **none recorded** | **UNVERIFIED** |
| architect | identity\*, tax_card\*, professional_license\*, tax_registration\*, portfolio | **none recorded** | **UNVERIFIED** |
| project_manager | identity\*, tax_card\*, professional_certificate\*, experience_record\*, insurance_certificate | **none recorded** | **UNVERIFIED** |

**Commercial registration authority:** not recorded.
**Business licensing authority:** not recorded.
**Contractor classification authority:** not researched — an Egyptian
contractor federation/classification regime may exist and is unestablished.
**Engineering regulator:** the array names an "engineering syndicate licence"
(نقابة المهندسين) without recording the body or a source.
**Public procurement authority:** not researched.
**Sub-jurisdiction distinctions:** not researched (governorate-level
requirements unknown).

### Correct / over-required / under-required / unverified (§16)

I cannot classify these as the directive asks, because no official Egyptian
source was read when they were written and none can be read now. **All five
roles: UNVERIFIED.** Two observations that require no source:

- **`bank_certificate`, `insurance_certificate`, `portfolio`,
  `product_catalogue`** have the shape of BuildHub trust requirements rather
  than legal obligations. If so they must be re-labelled `buildhub_policy` —
  which is legitimate — but presenting them as government requirements is not.
- **`identity` + `tax_card` as a universal pair across all five roles** has the
  shape of a platform template rather than a jurisdictional rule. That is the
  exact pattern the directive prohibits for the GCC, and it is already present
  in the live Egyptian configuration.

### Unresolved questions

Which body issues commercial registration, and is it required of a sole
professional as well as a company? Is an engineering syndicate registration
mandatory to practise, to sign drawings, or only to be employed? Does Egypt
operate a contractor classification/federation regime, and does it condition
private work? Which of the five configured slots are legal and which are
BuildHub's? Are there governorate-level differences?

Egypt's live onboarding is **untouched** by this report. `marketComplianceReadiness('EG')`
returns **not ready** — recording it as verified to make the table look finished
would be the fabrication this work exists to prevent.

---

## 6. Saudi Arabia — SA / SAR

| | |
|---|---|
| Market code / currency / fraction digits | SA / SAR / **2** |
| Registry state | registered, **disabled** |
| BuildHub enablement | not enabled |
| Technical readiness | ✅ (money scale not a blocker — SAR is 2-digit) |
| Compliance readiness | ❌ unverified |
| Staging / owner acceptance | ❌ blocked / pending |
| Production activation state | **BLOCKED** |

### Narrative

The only GCC market where discovery produced a named authority for contractor
classification. Per directive §8 I did **not** assume that classification
applies identically to private homeowner renovation, municipal works,
government infrastructure and engineering consultancy — establishing that
distinction is the central open question.

### Evidence matrix

| Layer | Requirement | Authority | Official source | Private work | Public procurement | Verification | Evidence |
|---|---|---|---|---|---|---|---|
| D | Contractor classification certificate | Ministry of Municipal, Rural Affairs and Housing (MOMAH) | `momah.gov.sa/en/e-services/submit-classification` | **unread** | **unread** | classification grade | **DISCOVERED — NOT READ** |
| C | Professional engineering registration | *not identified* | — | — | — | professional membership | **UNVERIFIED** |
| A | Commercial registration | *not identified* | — | — | — | registration number | **UNVERIFIED** |
| C | Architectural practice registration | *not identified* | — | — | — | professional membership | **UNVERIFIED** |
| C | Project management credential | *not identified* | — | — | — | manual review | **UNVERIFIED** |

**Contractor regulator:** MOMAH (discovered).
**Commercial registration / business licensing authority:** not identified.
**Engineering regulator:** not identified.
**Supplier rules:** not identified.
**Public procurement authority:** not identified separately from MOMAH.
**Sub-jurisdiction:** municipal variation possible, unestablished.
**Roles affected:** all five.
**Government requirements verified:** none.
**Conditional requirements:** all entries provisionally `conditional`.
**Public-procurement-only:** none yet assigned — scope unread.
**BuildHub-specific policies:** none assigned.

### Unresolved questions

Does classification condition all contracting work or only public/municipal
procurement? Which grades exist, and does grade cap project value? Which body
regulates individual engineering practice, and is registration required to
*practise*, to *sign drawings*, or only to be *employed by a licensed office*?
Is architecture regulated separately from engineering? Is construction project
management a licensed activity at all — if not, any BuildHub requirement there
must be `buildhub_policy`. What are the implications for a foreign or
other-GCC provider serving Saudi work?

---

## 7. United Arab Emirates — AE / AED

| | |
|---|---|
| Market code / currency / fraction digits | AE / AED / **2** |
| Registry state | registered, **disabled** |
| Technical readiness | ✅ |
| Compliance readiness | ❌ unverified **and sub-jurisdiction-scoped** |
| Production activation state | **BLOCKED** |

### Narrative

The sub-jurisdiction concern in directive §9 is **confirmed by discovery**.
Engineering practice is administered by genuinely different authorities in
different emirates. A single federal list would be wrong for both emirates
investigated.

The commercial market stays `AE` with one currency. Compliance differing by
emirate is **not** a reason to split a currency or a marketplace, and a test
asserts exactly one `AE` registry row.

### 7a. Dubai

| Layer | Requirement | Authority | Official source | Evidence |
|---|---|---|---|---|
| C | Engineer qualification | Dubai Municipality | `dm.gov.ae/municipality-business/consultants-and-contractors-licensing-standards/` | **DISCOVERED — NOT READ** |
| B/D | Contracting licence | emirate-level (unconfirmed) | same page | **UNVERIFIED** |

Discovery referenced a Dubai engineering qualification system and a regulatory
framework in which the municipality assesses and licenses institutions,
accredits staff and renews professional practice certificates. **Its role as a
precondition for offering services privately is unread.**

**Unresolved:** what Dubai requires of an *individual engineer* versus a
*licensed consulting office*, and whether the two are separable; trade
licensing authority for a materials supplier; whether contracting activity
classification differs by building type.

### 7b. Abu Dhabi

| Layer | Requirement | Authority | Official source | Evidence |
|---|---|---|---|---|
| C | Engineer licence card | Department of Municipalities and Transport (DMT) | `tamm.abudhabi/.../IssuingEngineerLicence` | **DISCOVERED — NOT READ** |
| C | Architectural qualification | DMT | `pages.dmt.gov.ae/en/Architecture-Engineering-Exam` | **DISCOVERED — NOT READ** |

Discovery referenced an engineering registry with graded categories and a
professional qualification examination. **Specific grade names and resolution
numbers appeared in search summaries and are deliberately not restated here**,
because they were not read from the authority's own page and a wrong grade name
in a compliance screen is a confident error.

**Unresolved:** whether a licence is required to *offer services to private
clients* or only to *submit work to the authority*; the current grade
structure; business licensing authority for contracting and supply.

### 7c. Other emirates / unresolved scope

**Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah and Fujairah: no research
performed.** Whether they require distinct treatment for the activities
BuildHub supports is **unestablished**. Treating two researched emirates as
representative of all seven would be the flattening directive §9 prohibits.

### What cannot be one universal AE rule

- individual engineering authorization (different authority per emirate)
- individual architectural authorization
- contracting licensing (authority not even identified federally)
- the licensing authority itself

### What stays unified

- the commercial market: `AE`
- the currency: `AED`
- money precision, work-location authority, RFQ/quotation derivation

---

## 8. Qatar — QA / QAR

| | |
|---|---|
| Market code / currency / fraction digits | QA / QAR / **2** |
| Registry state | registered, **disabled** |
| Technical readiness | ✅ |
| Compliance readiness | ❌ unverified |
| Production activation state | **BLOCKED** |

### Evidence matrix

| Layer | Requirement | Authority | Official source | Applicability as configured | Evidence |
|---|---|---|---|---|---|
| E | Contractor classification | Ministry of Finance — Monaqasat | `monaqasat.mof.gov.qa` | **public_procurement_only** (pending confirmation) | **DISCOVERED — NOT READ** |
| C | Registration in engineers record | Ministry of Municipality | `hukoomi.gov.qa/en/services/renew-registration-in-engineers-record` | conditional | **DISCOVERED — NOT READ** |
| A | Commercial registration | Ministry of Commerce and Industry | `moci.gov.qa/en` | conditional | **DISCOVERED — NOT READ** |
| E | Company registration for tenders | Ashghal (Public Works Authority) | `ashghal.gov.qa` (discovered, not configured) | procurement | **DISCOVERED — NOT READ** |

### Monaqasat scope — the §12 question

Discovery indicates Monaqasat is the Ministry of Finance procurement platform
and that contractor classification there exists for **participation in
government tenders**, with specialisations in buildings, roads, sewage, water
and agriculture.

That is **suggestive, not evidence**. It is configured
`public_procurement_only` and therefore **hidden from private-work providers**,
with a test asserting it does not reach them. If reading the page shows it also
conditions private contracting, applicability changes — and that is a
**configuration edit, not a code change**.

### Unresolved questions

Is Monaqasat classification required only for public tenders? Is engineers-record
registration mandatory to offer engineering services privately, and which
specialisations and categories exist? What must a building-materials supplier
hold to sell to private buyers? Does architecture register through the engineers
record or separately? Is project management a licensed activity?

---

## 9. Kuwait — KW / KWD

| | |
|---|---|
| Market code / currency / fraction digits | KW / KWD / **3** ⚠ |
| Registry state | registered, **disabled** |
| Technical readiness | ✅ (three-decimal storage in place) |
| Compliance readiness | ❌ unverified |
| Production activation state | **BLOCKED** |

### Evidence matrix

| Layer | Requirement | Authority | Official source | Applicability as configured | Evidence |
|---|---|---|---|---|---|
| E | Contractor registration | Central Agency for Public Tenders | `e.gov.kw/.../CTC/RegContractor.aspx` | **public_procurement_only** (pending) | **DISCOVERED — NOT READ** |
| C | Engineering practice authorisation | *regulator not identified* | `e.gov.kw/.../KM/EngineeringOfficesRegulation.aspx` | conditional | **DISCOVERED — NOT READ** |
| A/B | Commercial licence | *not identified* | — | conditional | **UNVERIFIED** |
| C | Architectural authorisation | *not identified* | — | conditional | **UNVERIFIED** |
| C | Project management credential | *not identified* | — | conditional | **UNVERIFIED** |

### An important nuance

The engineering page discovered concerns **engineering *offices***, not
individual engineers — it lists organizational approval, topography, building
licence and supervision undertaking requests. What is required of an
*individual* engineer versus a *registered office* is unestablished, and
conflating them would misdirect every freelance engineer in the market.

### Unresolved questions

**What licenses ordinary private contracting in Kuwait is not identified** —
only a procurement-side registration was found. Is the CAPT registration a
tender prerequisite rather than a licence to contract privately? Which body
authorises individual engineering practice? Which authority licenses a
materials supplier?

---

## 10. Bahrain — BH / BHD

| | |
|---|---|
| Market code / currency / fraction digits | BH / BHD / **3** ⚠ |
| Registry state | registered, **disabled** |
| Technical readiness | ✅ |
| Compliance readiness | ❌ unverified |
| Production activation state | **BLOCKED** |

### Narrative

Bahrain shows the clearest discovered **separation of layers**: a dedicated
professional council for engineering (Layer C), distinct from a ministry
prequalification for tenders (Layer E). That separation is exactly what the
layer model exists to preserve.

### Evidence matrix

| Layer | Requirement | Authority | Official source | Applicability as configured | Evidence |
|---|---|---|---|---|---|
| C | Engineer licence | Council for Regulating the Practice of Engineering Professions (CRPEP) | `bahrain.bh/.../GSX-UI-PServiceDetails?psID=4023` | conditional | **DISCOVERED — NOT READ** |
| E | Contractor prequalification | Ministry of Works | `bahrain.bh/.../GSX-UI-PServiceDetails?psID=2332` | **public_procurement_only** (pending) | **DISCOVERED — NOT READ** |
| A | Commercial registration | Ministry of Industry and Commerce | `moic.gov.bh/en` | conditional | **DISCOVERED — NOT READ** |
| C | Architectural licence | CRPEP (assumed discipline — unconfirmed) | — | conditional | **UNVERIFIED** |
| C | Project management credential | *not identified* | — | conditional | **UNVERIFIED** |

Per directive §14 the Ministry of Works prequalification is **not** treated as
a universal private-market requirement. Discovery describes it as for inclusion
in the list of qualified contractors approved for Ministry of Works tenders.

### Unresolved questions

Is architecture one of CRPEP's licensed disciplines or regulated elsewhere? What
licenses private contracting? **Sijilat's role in business/activity licensing
was not researched.** Is the engineer licence required to offer services
privately or only to submit work to authorities? Do CRPEP licences carry
disciplines and grades, and do they expire?

---

## 11. Oman — OM / OMR

| | |
|---|---|
| Market code / currency / fraction digits | OM / OMR / **3** ⚠ |
| Registry state | registered, **disabled** |
| Technical readiness | ✅ |
| Compliance readiness | ❌ unverified |
| Production activation state | **BLOCKED** |

### Narrative

**Oman carries more weight than the other five.** The provider whose
mislabelled currency opened this entire workstream operates in this market. The
question of what licenses ordinary private contracting in Oman is therefore not
academic — there is a real affected user.

### Evidence matrix

| Layer | Requirement | Authority | Official source | Applicability as configured | Evidence |
|---|---|---|---|---|---|
| E | Tender Board registration and classification | Tender Board | `omanuna.oman.om/en/online-services/tender-board-registration-classification` | **public_procurement_only** (pending) | **DISCOVERED — NOT READ** |
| C | Engineering practice registration | *not identified* | — | conditional | **UNVERIFIED** |
| A | Commercial registration | *not identified* | — | conditional | **UNVERIFIED** |
| C | Architectural registration | *not identified* | — | conditional | **UNVERIFIED** |
| C | Project management credential | *not identified* | — | conditional | **UNVERIFIED** |

Discovery indicates Tender Board classification gives registered companies a
grade determining **bidding rights** — which type of tender project they may
participate in — and that required documents include chamber of commerce
certificates, professional licences, Omanization ratios, tax certificates and
experience credentials. That is a **procurement** shape, so it is configured
accordingly.

**Esnad was not researched.** Supplier registration was not researched.

### Unresolved questions

**What licenses ordinary private contracting in Oman** — the single most
consequential unanswered question in this report. Which authority registers
individual engineering practice? Which body issues commercial registration?
Does Tender Board classification govern tender eligibility only?

---

## 12. Provider Role Matrix

BuildHub roles: `contractor`, `supplier`, `engineer`, `architect`,
`project_manager`.

| Potential mismatch | Observation | Status |
|---|---|---|
| **Individual vs firm** | Discovery suggests several jurisdictions regulate the engineering **office / consultancy**, not the individual. Kuwait's discovered page concerns offices. Dubai's references institutions and accredited staff. BuildHub's roles are person-shaped. | **GAP — real** |
| **Architect vs engineer** | Abu Dhabi discovery showed "Architecture Engineering", suggesting architecture may sit *inside* engineering regulation in some markets rather than beside it | **UNVERIFIED** |
| **Project manager** | May not be a regulated activity anywhere in the GCC. If so, every BuildHub requirement for that role is `buildhub_policy` by definition | **UNVERIFIED** |
| **Supplier** | Likely Layers A+B only (registration + trade licence), not a professional credential | **UNVERIFIED** |
| **Contractor** | Too coarse — see §19 on activity | **GAP — likely** |

No one-to-one mapping was forced. Where a role's regulatory concept is
unidentified, the configuration records that rather than guessing.

### §18 — Company vs individual

The compliance engine takes `market`, `role`, `subJurisdiction` and `activity`.
It has **no legal-form dimension**: company, sole establishment, individual
professional, freelancer, foreign branch, GCC entity.

`vendorProfiles` carries a company name, trading name and registration number,
but no structured legal form. **Smallest general model gap:** one `legalForm`
dimension on the provider and an optional `legalForms[]` narrowing on a
requirement — the same shape as `activities[]`, which already works.

**Not implemented.** Whether it is needed depends entirely on the research, and
the directive says not to redesign immediately.

### §19 — Activity-specific requirements

A provider declaring `contractor` may be too broad. Requirements may depend on
building construction, maintenance, electrical, plumbing, HVAC, demolition,
roads, landscaping, specialised installation, engineering consultancy,
architecture or materials supply.

**Representable:** yes — `MarketRequirement.activities[]` narrows a requirement
to named activities, and a provider who has not stated an activity is not shown
a requirement that may not apply. Tested.

**Populated:** no. No requirement currently carries an activity narrowing,
because none is verified. **Whether a high-grade building-contractor credential
should be demanded of an electrician is precisely the kind of question that
must be answered from the authority's own page, not assumed.**

### §20 — Project-specific requirements

Requirements may change by project value, type, building type, floor count,
size, public/private status, municipality, engineering complexity or
classification grade.

**BuildHub can evaluate provider-onboarding eligibility. It cannot evaluate
per-project eligibility.** The engine takes market, role, sub-jurisdiction and
activity — **no project attributes at all**. A rule of the form "classification
grade 3 or above for projects over X" cannot currently be expressed or
evaluated.

Whether that dimension is needed is unknown until the research is done. Adding
it now would be speculative (directive §27).

---

## 13. Private vs Public Work Matrix

| Market | Private residential | Private commercial | Government procurement | Special infrastructure |
|---|---|---|---|---|
| EG | current array (**unverified**) | same array | **not researched** | not researched |
| SA | **unverified** | **unverified** | MOMAH classification (scope unread) | not researched |
| AE | emirate-level (unread) | same | not researched | not researched |
| QA | **unverified** | **unverified** | Monaqasat — configured procurement-only | Ashghal (discovered) |
| KW | **unidentified** | **unidentified** | CAPT — configured procurement-only | not researched |
| BH | **unverified** | **unverified** | Ministry of Works — configured procurement-only | Tender Board implications unread |
| OM | **unidentified** | **unidentified** | Tender Board — configured procurement-only | not researched |

### Implemented behaviour

`ComplianceContext.publicProcurement` defaults to **false**. A tender-board
classification **cannot** gate a homeowner's RFQ. Tests assert this for all
four discovered procurement schemes (QA, KW, BH, OM), and separately assert
that each market has at least one procurement-scoped entry so the filter is not
vacuous.

### The inverse risk, stated

A private-market baseline must not be represented as sufficient for government
tender work. BuildHub does not offer public procurement today, so this cannot
currently mislead — but it becomes live the day it does.

### §22 — Procurement future-proofing

Procurement credentials are **retained conditionally**, not removed. When
BuildHub supports public-sector opportunities the *same configured
requirements activate by context* — no second compliance engine, no
re-research. The applicability dimension currently distinguishes
`all_providers`, `public_procurement_only` and `conditional`; a
`municipal_project` or `regulated_special_activity` dimension can be added as
configuration if the research shows one is needed.

---

## 14. Government vs BuildHub Requirements

Three provenance values, closed and distinct:

| Value | Meaning |
|---|---|
| `legal_requirement` | A government or regulator requires it. BuildHub relays an obligation. |
| `buildhub_policy` | BuildHub requires it for trust or safety. No regulator asked. |
| `optional_credential` | Nobody requires it. It strengthens a profile. |

`isGovernmentObligation()` exists so the UI asks this question rather than
reading `required`, which cannot distinguish a ministry's rule from BuildHub's.

### Current state

Every GCC entry is provisionally `legal_requirement` **and** `unverified` —
i.e. "we believe a regulator requires something here and have not confirmed
what". Nothing is labelled `buildhub_policy` yet, and **Egypt's array carries
no provenance at all**.

Assigning provenance to Egypt's existing five-per-role list is a required
pre-activation task and partly a product decision (see §40, D2).

---

## 15. Compliance Evidence Matrix

30 entries across six GCC markets × five roles, plus Egypt's market-level note.
**Every entry `unverified`.**

Each entry carries: requirement type, name (EN + AR), description (EN + AR),
authority (with jurisdiction where sub-national), applicability, applicability
condition, sub-jurisdiction narrowing where relevant, verification method,
candidate source title, candidate official URL where discovered, and a specific
open question.

### Asserted by test

- no entry claims `verified`
- every open question is substantive (length-checked, not a placeholder)
- **no unverified entry has `required: true`** — nothing may be demanded of a
  provider on the strength of a rule BuildHub has not read
- every `conditional` entry states its condition in words
- no GCC role's type set mirrors Egypt's
- no authority name appears in two countries
- every candidate URL matches an official-domain pattern
- a market config answers only for its own market

### §5 field coverage

| Directive field | Implemented as |
|---|---|
| market | `MarketComplianceConfig.marketCode` |
| role / activity | config key + `activities[]` |
| requirement | `type`, `name`, `description` |
| authority | `authority.name` / `.nameAr` |
| jurisdiction | market code |
| sub-jurisdiction | `authority.jurisdiction` + `subJurisdictions[]` |
| requirement type | `type` |
| mandatory / conditional / optional / unverified | `provenance` + `applicability` + `evidence.state` |
| applicability condition | `applicabilityCondition` |
| private work applicability | derived: `applicability !== 'public_procurement_only'` |
| public procurement applicability | `applicability === 'public_procurement_only'` |
| verification method | `verification` |
| official source | `evidence.officialSource` / `.candidateSource` |
| source title | same |
| date verified | `evidence.verifiedOn` |
| BuildHub interpretation | `evidence.interpretation` |
| confidence / evidence status | `evidence.state` |

### §27 — missing dimensions revealed by research

| Dimension | Status |
|---|---|
| Credential **expiry / renewal** | ❌ **missing** — see §17 |
| **Legal form** (company vs individual) | ❌ **missing** — see §12 |
| **Project attributes** (value, grade threshold) | ❌ **missing** — see §12 |
| Requirement **version / effective date** | ❌ missing — see §29 |

All four were revealed by actual research rather than imagined. **None has been
added**, per directive §27.

---

## 16. Verification Methods

Seven implemented: `registration_number`, `licence_number`,
`classification_grade`, `professional_membership`, `certificate`,
`document_upload`, `manual_review`.

**Document upload is the fallback, not the default** — a test fails if it
exceeds half of all configured entries.

### §24 — Data minimisation

A government may demand degrees, experience records, insurance, staff lists,
financial statements and equipment schedules in order to **issue** a licence.
Once it has, verifying the resulting licence is less to ask of the provider,
less personal data to store, and checks the authoritative **outcome** rather
than its inputs.

The distinction the architecture draws:

- **evidence the government required to issue the credential** — BuildHub
  should generally not re-collect this
- **the credential BuildHub needs to verify** — the licence, registration
  number or classification grade

**Per-requirement determination is pending the official pages.** This is a
privacy and onboarding-friction matter, not only a compliance one.

### Not currently available

`government API / registry lookup` and `QR verification` are **not implemented
and not in the method vocabulary** — no GCC registry integration exists.
`self-declaration` and `not currently verifiable` are also absent; whether they
are needed depends on the research.

---

## 17. Credential Expiry & Reverification

**GAP — not modelled at all.**

No expiry, renewal or re-verification field exists on `providerMarkets`,
`registrationDocuments` or `MarketRequirement`. Compliance is modelled as
**permanent approval**.

Discovery indicates renewal processes exist — Kuwait's "Contractor Subscription
**Renewal**", Qatar's "**Renew** Registration in Engineers Record". If a
government credential expires and BuildHub's market approval does not, BuildHub
would be asserting an approval the regulator has withdrawn.

**This is a real model gap and a pre-activation blocker, not a polish item.**
Not implemented — no speculative fields (directive §27).

### What a correct model would need

- expiry date on the provider's held credential
- the requirement's renewal cadence where known
- a re-verification trigger and a grace/lapse behaviour
- a status value meaning *expired* (see §26 below)

---

## 18. Legacy Migration Review

Verified on populated fixtures, seeded **before** migration 0065 so the
evidence ordering matches production exactly.

```
legacy rows               6
proven_eg                 2
remediation_required      4
authoritative offer rows  2
```

### The exact conjunction for `PROVEN_EG` — all four required

1. the stored currency is `EGP`
2. an **approved** legacy Egyptian registration instrument — `tax_card`,
   `commercial_registration` or `tax_registration` — with `marketCode IS NULL`
   (legacy, because the column did not exist and Egypt is the only requirement
   set ever configured, so an approved one was approved against Egyptian
   requirements)
3. an **approved** Egypt row in `providerMarkets`
4. the free-text country does **not** contradict Egypt

### §28 special review — resolved, no correction needed

The directive was right to demand scrutiny of the phrase "a blank country is
proven". **That phrasing was imprecise; the classifier is not.** Verified
empirically:

| Case | Result |
|---|---|
| full evidence + country `"Egypt"` | `proven_eg` |
| full evidence + country `null` / `undefined` / `""` / whitespace | `proven_eg` |
| full evidence + country `"Oman"` | `remediation_required` |
| **blank** + no EGP denomination | `remediation_required` |
| **blank** + no approved Egyptian instrument | `remediation_required` |
| **blank** + no Egypt approval row | `remediation_required` |
| **blank alone, nothing else** | `remediation_required` |

Blank and a stated `"Egypt"` are **indistinguishable** given identical other
evidence — so the field cannot be out-performing a stated value, which is the
only way it could be acting as evidence.

**Conclusion: `country IS NULL` is at most *not a disqualifier*. It is never
positive evidence.** The country field can only ever subtract. A blank-country
row is proven because of what **is** known about it, never because of what is
not.

Three mutation-proof tests now hold this, including the substitution test:
blank must not stand in for any positive condition.

### False-positive protections

Every condition can only **shrink** the proven set. There is no path by which
adding information makes a row proven.

### The accepted false-negative cost

A false negative asks a provider to confirm their own price — recoverable. A
false positive publishes a number in a currency they never chose — not
recoverable, and it misrepresents their commercial intent.

### What remediation providers will experience in the UI

`services.marketOffers` returns `needsConfirmation: true` for their service.
Their legacy value and original denomination are preserved and unchanged; zero
`serviceOfferingMarkets` rows exist for them, so the service is **unpublished
in every market** until they confirm or re-enter the price.

**The UI for this is not built** — see blocker B7. Today a remediation provider
would have no way to act on the flag.

---

## 19. Money / Currency / Precision Review

| Market | Currency | Fraction digits | Storage scale | Display scale |
|---|---|---|---|---|
| EG | EGP | 2 | 3 | 2 |
| SA | SAR | 2 | 3 | 2 |
| AE | AED | 2 | 3 | 2 |
| QA | QAR | 2 | 3 | 2 |
| KW | KWD | **3** | 3 | **3** |
| BH | BHD | **3** | 3 | **3** |
| OM | OMR | **3** | 3 | **3** |

**Sixteen market-denominated money columns at scale 3.** Integer capacity
preserved — precision was raised *alongside* scale, because raising scale alone
would have cost every column a factor of ten of headroom and surfaced later as
a large legitimate budget being refused, which looks nothing like a currency
bug.

**Five columns deliberately at scale 2**, each with a recorded reason: two
ratings (0.00–5.00), two quantities, and `vendorSubscriptions.priceAmount`
(billing domain, EGP-only, guarded by a test that fails if
`SUPPORTED_CURRENCIES` ever gains a three-digit currency).

### Calculation precision

`shared/quotationPricing.ts` rounds to the **currency's own scale** at every
step via `roundToScale(value, fractionDigitsFor(currency))`. An unknown
currency throws `UnknownCurrencyScaleError` rather than defaulting to 2.

`projectSpend.spentFor` takes the project's currency; an **unknown** currency is
not rounded at all rather than rounded to two, because rounding to a scale
nobody can name is how a minor unit goes missing. It does not throw — a bad
currency code must not take a project page down.

### Round-trip proof against real MariaDB

| Step | Result |
|---|---|
| write `1234.567` to the **old** `DECIMAL(12,2)` column | returned `1234.57` — **the defect, reproduced** |
| after migration 0063, write `1234.567` | returns `1234.567` ✅ |
| legacy `1450.00` row after widening | returns `1450.000` — same amount, lossless ✅ |
| integer capacity | `9999999999.999` fits — ten integer digits preserved ✅ |
| per-market independent pricing | `25.000` / `7.125` / `9.250` intact across seven markets ✅ |

### Display

`formatMoney` uses each currency's own `maximumFractionDigits` from the
registry, with `minimumFractionDigits: 0` as a deliberate product choice so a
whole-unit price does not drag a trailing `.00` through a dense table. The rule
is a **cap**, not a fixed width.

---

## 20. Work-Location & Cross-Border Review

### The chain

```
work location → BuildHub market → RFQ currency → quotation currency
```

| Step | Behaviour | Verified |
|---|---|---|
| Project creation | states work country explicitly; disabled market refused | ✅ |
| Project-backed RFQ | inherits project market **server-side** | ✅ |
| Conflicting client market on a project-backed RFQ | **REFUSED**, not silently discarded | ✅ |
| Project in a no-longer-enabled market | **REFUSED**, not defaulted to Egypt | ✅ |
| Standalone RFQ | explicit market, validated against the enabled set | ✅ |
| RFQ currency | derived from market via registry | ✅ |
| Quotation currency | inherited from `rfqs.currency`; **no client input field** | ✅ |

### What may never override it

Asserted by test over the market-resolution region: no `req.ip`, no
`x-forwarded-for`, no geoip, no `navigator.language`, no accept-language. No
provider country, no subscription currency.

### Cross-border (§31)

| Case | Architecturally supported | Exercisable today |
|---|---|---|
| Egypt requester → Oman work → OMR | ✅ | ❌ needs OM enabled |
| Saudi requester → UAE work → AED | ✅ | ❌ |
| Oman provider approved in Saudi → Saudi RFQ → SAR | ✅ | ❌ |
| UAE provider approved in Qatar → Qatar RFQ → QAR | ✅ | ❌ |

Legal/home country is **not an input** to any eligibility or currency decision,
so it cannot prohibit legitimate cross-border operation where market approval
permits it.

### Cross-border confirmation UX

Confirmed, **not warned**. Default border, muted surface, no warning colour, no
`role="alert"`. It states the work location, the resulting quotation currency
and the account-country difference, then offers *continue* or *change work
location*. An Egyptian developer building in Oman is a customer, not an
anomaly, and styling it as a problem would say otherwise.

The account country is a **separate prop** from the work location, specifically
so it can never become one.

---

## 21. Provider Eligibility Review — ⚠ THE ENGINEERING BLOCKER

### The canonical predicate

```
market ENABLED
  AND provider APPROVED for that market
  AND an ACTIVE offer for the service in that market   (service-level questions)
  AND the existing category / visibility / project / business rules pass
```

### All callers: ZERO

`shared/marketEligibility.ts` has **no non-test caller anywhere in the
product**.

The Phase 3 commit said discovery, matching and quotation eligibility
"converge here". **They do not yet.** The predicate exists, is correct across
every branch, and is mutation-proved — and nothing consults it.

### Why no gate caught this

The reachability census covers **tRPC procedures**. `marketEligibility` is a
shared function, so no existing guard applied and the gap was invisible to
every green gate.

### Why it is not a present-day defect

Discovery is market-**blind**. `publicProductFilter`, `publicServiceFilter` and
`directoryVisibilityFilter` carry **no market dimension at all**. With exactly
one enabled market there is nothing to filter between — a market-blind query
and a market-aware one return identical rows. Nothing leaks because there is
nowhere to leak to.

### Why it becomes a defect the day a second market opens

The same query would show an Omani buyer every Egyptian provider and product,
and Egyptian buyers Omani ones — with provider approval and per-market offers
recorded correctly and **ignored at the point they matter**.

### What was done about it

A build gate was added (`f6d21be`): enabling a second market while discovery
cannot tell markets apart now **fails the build**, with a message naming the
enabled markets and what to wire. Mutation-checked by enabling Oman — it fires
with the exact diagnostic. Same fail-closed pacing as the money-scale
migration: the gap blocks activation rather than relying on memory.

---

## 22. Service Offer Review

`serviceOfferingMarkets`, unique on `(serviceOfferingId, marketCode)`.

| Property | Verified |
|---|---|
| Independent offers per market | ✅ seven markets on one service, all distinct |
| Changing one does not mutate another | ✅ Saudi changed, other six untouched |
| Duplicate `(service, market)` | ✅ refused by the unique constraint |
| Market determines currency | ✅ **no currency column exists** |
| No FX authority | ✅ no arithmetic on any price in the migration or router |
| Disabled market commercially inert | ✅ `mayManageOffer` refuses even with approval + active offer |

### The structural guarantee

There is **no currency column** on the offer. A stored currency beside a stored
market is a pair that can disagree, and `marketCode='OM', currency='EGP'` is
the exact row this workstream exists to prevent. Validating at the write closes
that only for paths that use the validator; with no column the inconsistent
state is **not representable**. The client has no currency field to send.

**Recorded trade-off:** if a market ever redenominated its currency, historical
offer rows would re-read in the new one. The legacy parent column — preserved,
never rewritten — holds what the provider originally entered.

---

## 23. RFQ & Quotation Review

- RFQ currency derived from market; quotation currency inherited from RFQ
- `submitQuotation` accepts **no** currency parameter
- validation bounds follow the columns — the authoritative total was capped a
  hundredth short of its own components (`.99` vs `.999`), which would have
  surfaced only on a three-digit currency as a refused quotation whose line
  items each validated fine. Corrected.
- `rfqItems.unitPriceSnapshot` now carries `unitPriceSnapshotCurrency`. A
  product whose own currency disagrees with the RFQ's contributes **no
  snapshot** — not a converted one, not a relabelled one. The line keeps its
  name, quantity and specification and has no indicative price, which is the
  truth.
- three quotation pricing strategies plus the single-figure method remain in
  one architecture; `quotations.price` is the single authoritative payable

---

## 24. Billing Separation

```
BILLING_CURRENCY     = 'EGP'
SUPPORTED_CURRENCIES = ['EGP']
```

**EGP only. No payment provider connected.**

### Enforced, not documented

- no transaction surface reads `BILLING_CURRENCY`
- none of `marketEligibility.ts`, `serviceOfferingMarkets.ts` or
  `projectMarketChange.ts` can see `BILLING_CURRENCY` or `vendorSubscriptions`
  — asserted by test
- `vendorSubscriptions.priceAmount` stays `DECIMAL(10,2)` with a guard that
  fails if billing ever supports a three-digit currency
- the three `toFixed(2)` sites in the billing domain now derive from the
  billing currency's scale — correct before and correct now, the difference
  being correct **by derivation** instead of by coincidence

The original finding — quotation currency taken from the supplier's
subscription plan — is now **structurally impossible**.

### What a GCC provider would experience (§35)

They would transact in their market's currency (SAR, AED, OMR…) while paying
BuildHub in **EGP**. They would see an Egyptian-pound subscription price with no
local equivalent, and FX exposure would sit with them.

The billing limitation does **not** block multi-market commerce — they are
different questions — but it is a visible oddity a Saudi or Emirati supplier
will notice. **Billing is not redesigned here.** See §40, D5.

---

## 25. Tax Boundary

No `market.defaultVatRate` exists and none was added. **A market does not imply
a tax rate.**

### Where the invariant actually lives

"An unstated VAT rate is NULL, not zero" is a property of the **rate**, echoed
as `number | null` precisely so a reader can tell "0% VAT" from "VAT not
stated". `vatAmount` is the arithmetic contribution to the total, and `0` is
correct there — a null would make the payable total unrepresentable.

VAT, discount, contingency and overhead never enter a percentage base and are
never double-counted. Contingency and overhead both apply to
`base − discount`, never compounded.

### Future tax architecture requirements — reported, not implemented

GCC VAT regimes differ by market and have changed over time. Some jurisdictions
require a tax registration number on invoices. Rates and registration
thresholds vary. Reverse-charge and cross-border supply rules may apply to a
provider in one market serving work in another — which this platform now
actively enables.

**A dedicated tax architecture remains a separate, unauthorized workstream.**
Research may identify tax systems; that must not become automatic quotation tax
behaviour.

---

## 26. Authorization & Privacy

| Property | Status | Negative tests |
|---|---|---|
| Provider manages only own offers | ✅ | wrong owner → `not_owner` |
| Ownership checked **first** | ✅ | not an oracle for competitors' approvals |
| Provider cannot gain approval by client input | ✅ | approval read from `providerMarkets`, never the request |
| Provider cannot see rival protected quotations | ✅ pre-existing, preserved | `rfqDetailAccess` suite |
| Requester cannot alter server-authoritative currency | ✅ | no input field exists |
| Market selection cannot bypass provider eligibility | ⚠ **eligibility not wired** | see §21 |
| Cross-market record leakage | ⚠ **discovery market-blind** | see §21 |
| Legal country cannot be mistaken for approval | ✅ | not an input to any decision function |
| Market interest cannot count as approval | ✅ **by absence** | see §39 |
| Disabled market refuses everywhere | ✅ | six markets × offer, project move, RFQ, project create |
| Not-found vs not-yours indistinguishable | ✅ | `NOT_FOUND` for both |

### §26 of the directive — status model sufficiency

`providerMarkets.status` is `not_started | under_review | update_required |
approved | rejected`.

**Regulatory lifecycle requires distinctions this cannot express:**

| Needed | Why it differs from what exists |
|---|---|
| **suspended** | A regulator sanction or BuildHub action on a previously approved provider. Not `rejected` (an application refused) and not `update_required` (remediation requested). |
| **expired** | The underlying credential lapsed. The provider did nothing wrong and the approval is nonetheless void. |

**The enum was NOT changed** — the directive says not to change it for
elegance, and this is reported as a gap rather than acted on. It is blocker
B11.

---

## 27. Localization / RTL

| Surface | EN | AR | Status |
|---|---|---|---|
| Market / country names | ✅ | ✅ | registry; a test requires Arabic for every market |
| Currency codes | ✅ | ✅ | `formatMoney` with `ar-EG` locale |
| Three-decimal formatting | ✅ | ⚠ | correct in code; **never visually reviewed in RTL** |
| Work-location field | ✅ | ✅ | keys added |
| Currency consequence line | ✅ | ✅ | keys added |
| Cross-border confirmation | ✅ | ✅ | keys added |
| Change-work-location control | ✅ | ✅ | keys added |
| Compliance requirement names | ✅ | ✅ | `name` / `nameAr` on every entry |
| **Authority names** | ✅ | ⚠ | `nameAr` present for some, **English-only for most** |
| Validation messages for new flows | ✅ | ⚠ | server messages are English-only |
| Service pricing / RFQ / quotation | ✅ | ✅ | pre-existing coverage |

### Gaps before GCC acceptance

- Arabic authority names for every configured requirement
- Arabic server-side validation messages for the new market refusals
- **No RTL visual QA has been performed on any GCC flow** — and cannot be
  without staging

---

## 28. Admin & Compliance Operations

**Confirmed needs. None implemented.**

| Need | Status |
|---|---|
| Review a submitted credential per market | ❌ `registrationDocuments.marketCode` exists; no per-market admin queue |
| Grant / reject market approval | ❌ **no admin UI for `providerMarkets` at all** |
| Record issuing authority | ❌ no field on the provider's held credential |
| Record credential number | ❌ no field |
| Record expiry | ❌ not modelled (§17) |
| Suspend a market approval | ❌ no `suspended` status (§26) |
| Request remediation | ⚠ `update_required` status exists; no UI |
| See source / provenance while reviewing | ✅ in config; ❌ not surfaced to an administrator |
| Audit history | ⚠ `registrationReviewEvents` exists but is not extended to market approvals |

**`providerMarkets` has no admin surface whatsoever.** Approval rows exist only
from the 0065 evidence backfill; nothing in the product can create, change or
revoke one. A market cannot be operated without this.

---

## 29. Regulatory Change Management

| Requirement | Supported |
|---|---|
| Source last-verified date | ✅ `evidence.verifiedOn` |
| BuildHub interpretation recorded | ✅ `evidence.interpretation` |
| Authority and source URL | ✅ |
| Unverified state that blocks | ✅ |
| Requirement **version** | ❌ |
| **Effective date** of the rule | ❌ |
| **Retired** requirement | ❌ |
| New requirement | ✅ (configuration addition) |
| Provider grandfathering / remediation | ❌ no mechanism |
| Forced re-verification | ❌ (depends on §17) |

Configuration changes remain **reviewed code changes**. No scraping, no
automation — as the directive requires.

---

## 30. Official Source Register

**Authoritative register. Official domains only — no third-party sources.** A
test asserts every candidate URL matches an official-domain pattern.

| Country | Authority | Page / document | Official URL | Publication date | BuildHub verified | Topics supported | Limitations |
|---|---|---|---|---|---|---|---|
| SA | MOMAH | Submit classification request | `momah.gov.sa/en/e-services/submit-classification` | unknown | **never** | contractor classification | not readable from this environment |
| AE-AZ | DMT | Issue an Engineer Licence Card | `tamm.abudhabi/en/life-events/business/housing-construction/engineering/IssuingEngineerLicence` | unknown | **never** | engineer licensing, Abu Dhabi | same |
| AE-AZ | DMT | Professional Qualification Exam — Architecture Engineering | `pages.dmt.gov.ae/en/Architecture-Engineering-Exam` | unknown | **never** | architectural qualification | same |
| AE-DU | Dubai Municipality | Consultants and Contractors Licensing Standards | `dm.gov.ae/municipality-business/consultants-and-contractors-licensing-standards/` | unknown | **never** | consultant + contractor licensing, Dubai | same |
| QA | Ministry of Finance | Monaqasat procurement platform | `monaqasat.mof.gov.qa` | unknown | **never** | contractor classification for tenders | same; scope unconfirmed |
| QA | Ministry of Municipality | Renew Registration in Engineers Record | `hukoomi.gov.qa/en/services/renew-registration-in-engineers-record` | unknown | **never** | engineer registration | same |
| QA | Ministry of Commerce and Industry | Ministry portal | `moci.gov.qa/en` | unknown | **never** | commercial registration | same; entry page only |
| KW | Central Agency for Public Tenders | Contractor Subscription Renewal | `e.gov.kw/sites/kgoEnglish/Pages/eServices/CTC/RegContractor.aspx` | unknown | **never** | contractor registration for tenders | same |
| KW | Kuwait Government Online | Engineering Offices Regulation | `e.gov.kw/sites/kgoenglish/Pages/eServices/KM/EngineeringOfficesRegulation.aspx` | unknown | **never** | engineering **offices** | concerns offices, **not individuals** |
| BH | CRPEP | Engineer's License Issuance | `bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=4023` | unknown | **never** | engineer licensing | same |
| BH | Ministry of Works | Contractor Prequalification Request | `bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=2332` | unknown | **never** | tender prequalification | same |
| BH | Ministry of Industry and Commerce | Ministry portal | `moic.gov.bh/en` | unknown | **never** | commercial registration | same; entry page only |
| OM | Tender Board | Registration & Classification | `omanuna.oman.om/en/online-services/tender-board-registration-classification` | unknown | **never** | classification, bidding rights | same |
| EG | — | **none recorded** | — | — | **never** | — | Egypt's live array cites no source at all |

**Fetch / read status for every row: BLOCKED — EGRESS DENIED.** Each was
discovered through search; none was opened.

### Third-party sources used only for discovery

Search results included consultancy and SEO pages. **None is in this register
and none is cited as authority** — they were used solely to surface the official
URLs above, which is the only use directive §6 permits.

---

## 31. Technical Readiness Matrix

| Dimension | EG | SA | AE | QA | KW | BH | OM |
|---|---|---|---|---|---|---|---|
| Currency / precision | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Work location | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Provider identity | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Provider approval (structure) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Service offers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Eligibility wired** | n/a | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| RFQ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quotation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cross-border | ✅ arch | ✅ arch | ✅ arch | ✅ arch | ✅ arch | ✅ arch | ✅ arch |
| Compliance engine | ✅ | ✅ | ✅ +sub-juris | ✅ | ✅ | ✅ | ✅ |
| **Compliance data** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Expiry model** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin surface** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Localization | ✅ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ |
| Tests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Staging | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Owner acceptance | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 32. Compliance Readiness Matrix

Blocking status is **BLOCKED** for every row. The evidence column is what
varies.

| Country | Role | A business existence | B activity licence | C professional | D contractor class. | E procurement | G optional | Verification | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| EG | contractor | configured, no source | — | — | — | not researched | — | document upload | **UNVERIFIED** |
| EG | supplier | configured, no source | — | — | — | — | — | document upload | **UNVERIFIED** |
| EG | engineer | configured, no source | — | configured, no source | — | — | — | document upload | **UNVERIFIED** |
| EG | architect | configured, no source | — | configured, no source | — | — | — | document upload | **UNVERIFIED** |
| EG | project_manager | configured, no source | — | configured, no source | — | — | — | document upload | **UNVERIFIED** |
| SA | contractor | unidentified | unidentified | — | MOMAH (unread) | unread | — | classification grade | DISCOVERED |
| SA | engineer | unidentified | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| SA | architect | unidentified | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| SA | supplier | unidentified | unidentified | — | — | — | — | registration no. | **UNVERIFIED** |
| SA | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |
| AE | engineer (AE-DU) | — | — | Dubai Mun. (unread) | — | — | — | licence no. | DISCOVERED |
| AE | engineer (AE-AZ) | — | — | DMT (unread) | — | — | — | licence no. | DISCOVERED |
| AE | architect | — | — | DMT exam (unread) | — | — | — | prof. membership | DISCOVERED |
| AE | contractor | unidentified | emirate-level (unread) | — | unidentified | — | — | licence no. | **UNVERIFIED** |
| AE | supplier | unidentified | emirate econ. dept (unidentified) | — | — | — | — | licence no. | **UNVERIFIED** |
| AE | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |
| QA | contractor | — | — | — | — | Monaqasat (unread) | — | classification grade | DISCOVERED |
| QA | engineer | — | — | Min. Municipality (unread) | — | — | — | prof. membership | DISCOVERED |
| QA | supplier | MoCI (unread) | — | — | — | — | — | registration no. | DISCOVERED |
| QA | architect | — | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| QA | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |
| KW | contractor | unidentified | unidentified | — | **unidentified** | CAPT (unread) | — | registration no. | DISCOVERED |
| KW | engineer | — | — | offices only (unread) | — | — | — | prof. membership | DISCOVERED |
| KW | supplier | unidentified | unidentified | — | — | — | — | licence no. | **UNVERIFIED** |
| KW | architect | — | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| KW | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |
| BH | engineer | — | — | CRPEP (unread) | — | — | — | licence no. | DISCOVERED |
| BH | contractor | unidentified | Sijilat? (not researched) | — | **unidentified** | MoW (unread) | — | classification grade | DISCOVERED |
| BH | supplier | MoIC (unread) | — | — | — | — | — | registration no. | DISCOVERED |
| BH | architect | — | — | CRPEP? (unconfirmed) | — | — | — | licence no. | **UNVERIFIED** |
| BH | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |
| OM | contractor | unidentified | unidentified | — | **unidentified** | Tender Board (unread) | — | classification grade | DISCOVERED |
| OM | engineer | — | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| OM | supplier | unidentified | unidentified | — | — | — | — | registration no. | **UNVERIFIED** |
| OM | architect | — | — | unidentified | — | — | — | prof. membership | **UNVERIFIED** |
| OM | project_manager | — | — | unidentified | — | — | — | manual review | **UNVERIFIED** |

**Optional credentials (Layer G): none configured in any market.** Nothing has
been identified as a non-blocking trust signal because nothing is verified yet.

---

## 33. Activation Blocker Matrix

Real blockers only, each stating exactly what is missing.

### All seven markets — including Egypt

| # | Blocker | What exactly is missing | Class |
|---|---|---|---|
| **B1** | Verified compliance requirements | Official pages read; applicability determined (private vs procurement); provenance assigned (law vs BuildHub policy); authority and verified date recorded. **Seven countries, not six.** | **COMPLIANCE DATA** |
| **B2** | Credential expiry not modelled | Expiry date on held credentials; renewal cadence; re-verification trigger; lapse behaviour | **ENGINEERING** |
| **B3** | No admin surface for `providerMarkets` | Grant, reject, suspend and remediate per-market approval; record authority and credential number; audit trail extension | **ENGINEERING** |
| **B4** | Egypt's provenance unassigned | Which of the five slots per role are legal requirements and which are BuildHub policy | **PRODUCT DECISION** |

### GCC markets only

| # | Blocker | What exactly is missing | Class |
|---|---|---|---|
| **B5** | Discovery market-blind; eligibility unwired | `marketEligibility` called from `publicProductFilter`, `publicServiceFilter`, `directoryVisibilityFilter` and the provider directory — **now build-gated** | **ENGINEERING** |
| **B6** | Provider market-pricing UI | A client caller for `services.marketOffers` and `services.setMarketOffer` | **ENGINEERING** |
| **B7** | Remediation UI | A surface where a provider acts on `needsConfirmation` to confirm or re-enter a legacy price | **ENGINEERING** |
| **B8** | Compliance onboarding UI | A surface rendering per-market applicable requirements with provenance, applicability and verification status | **ENGINEERING** |
| **B9** | Arabic authority / requirement names and validation messages | `nameAr` on every authority; Arabic server refusal messages | **ENGINEERING** |
| **B10** | Company vs individual legal form | A `legalForm` dimension on the provider and optional narrowing on a requirement — **only if B1 shows it is needed** | **ENGINEERING** (pending B1) |
| **B11** | `providerMarkets.status` insufficient | `suspended` and `expired` values, and the transitions into them | **ENGINEERING** |

### UAE specifically

| # | Blocker | What exactly is missing | Class |
|---|---|---|---|
| **B12** | Emirate-of-work capture | A product decision on whether and where to capture emirate, then the field | **PRODUCT DECISION** → ENGINEERING |
| **B13** | Five emirates unresearched | Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah | **COMPLIANCE DATA** |

### Process

| # | Blocker | What exactly is missing | Class |
|---|---|---|---|
| **B14** | Claude → staging connectivity | `onrender.com` allowed in the environment's network access | **DEPLOYMENT** |
| **B15** | Finishing release website acceptance | Owner opens the deployed candidate and tests the two journeys | **OWNER ACCEPTANCE** |
| **B16** | GCC staging matrix execution | Exact SHA deployed, `/version` verified, matrix run | **DEPLOYMENT** |
| **B17** | GCC owner website acceptance | Owner tests seven-market behaviour in EN and AR | **OWNER ACCEPTANCE** |
| **B18** | Production activation authorization | Owner reviews the exact activation diff and authorizes | **PRODUCTION OPERATIONS** |

### Not blockers

- **Money precision** — complete and proven for all seven currencies
- **Three-decimal storage** — complete; KW/BH/OM no longer gated on it
- **SAR/AED/QAR being two-digit** — this never made those markets ready; it
  only meant they were not blocked by the storage gate

---

## 34. Staging Acceptance Plan

### Current state

```
CLAUDE → STAGING CONNECTIVITY: BLOCKED
```

Distinct from **STAGING WEBSITE DOWN**. Re-verified for this report: HTTP 000,
CONNECT 403 at the proxy; GitHub control returns 200. Remedy: allow
`onrender.com` in the environment's network access.

When reachable: `GET /version` and confirm the **exact SHA** and
`environment=staging` **before** any functional assertion. A green test suite
proves the candidate; it proves nothing about what the website is running.

### Requester matrix

| Market | Work location | Expected currency | Precision check |
|---|---|---|---|
| EG | Egypt | EGP | 2 |
| SA | Saudi Arabia | SAR | 2 |
| AE | UAE | AED | 2 |
| QA | Qatar | QAR | 2 |
| KW | Kuwait | KWD | **3** |
| BH | Bahrain | BHD | **3** |
| OM | Oman | OMR | **3** |

### Provider matrix

Market approval visible → market-specific offer configurable → appears in that
market's discovery → can respond to that market's RFQ → quotation currency
**locked** to the RFQ's, with the reason shown.

### Negative matrix

| Case | Expected |
|---|---|
| Wrong market selected | refused |
| Disabled market | refused |
| Interest only | grants nothing |
| Unapproved provider | not discoverable, cannot respond |
| Approved but no offer | not discoverable for that service |
| Cross-market offer | does not satisfy another market |
| Client sends a currency | refused / ignored — no field exists |
| Conflicting project vs RFQ market | refused, not silently preferred |
| Project market change with a quotation present | hard refusal with the reason |

### §56 — three-decimal owner tests

Values chosen so loss is **visually detectable**. `25.000` would not prove
anything, because a truncation to two digits would still read `25.00`.

| Currency | Enter | Must display | A truncation bug would show |
|---|---|---|---|
| KWD | `25.125` | `25.125` | `25.13` or `25.12` |
| BHD | `9.875` | `9.875` | `9.88` |
| OMR | `7.625` | `7.625` | `7.63` |

Check at **five points**: the entry field, the saved offer, the RFQ budget, the
quotation total, and the quotation comparison screen.

---

## 35. Owner Website Acceptance Plan

Four states, never inferred from one another:

```
CODE / RELEASE-GATE  →  DEPLOYED / STAGING  →  OWNER WEBSITE ACCEPTANCE  →  PRODUCTION
```

### §54 — the finishing release acceptance remains OPEN

GCC work has **not** erased it. RC `d4fa871c` is code-gated PASS and merged into
`main` as `cc4b1ed` with an empty diff — and **it has never been seen on a
website**.

Two journeys are prepared and waiting on connectivity:

1. **The modal defect originally reported.** `/rfq` → Post an RFQ → category
   **Renovation** (Arabic: **تشطيب وترميم**) → Finishing details panel appears
   → scroll to the bottom → submit. Expect: dialog inside the viewport, title
   fixed, only the form scrolling, Submit and Cancel always reachable, long
   *لا أعرف* chips wrapping rather than clipping, page behind not moving.
   Repeat at a short window, on a phone, and in Arabic.
2. **The four pricing methods.** An open RFQ → Respond → switch between
   **Quoted total**, **Percentage of material cost**, **Finishing package** and
   **Detailed / BOQ**. Expect: each method's own fields, live recalculation,
   currency from the request not the account, scope as
   *included / excluded / not stated* with "not stated" never rendering as
   "excluded".

**Automated PASS does not imply owner PASS.** An owner-found defect is
`OWNER WEBSITE ACCEPTANCE: FAIL` → reproduction recorded → fixed on a new SHA →
gate rerun → redeployed → returned for another acceptance pass.

---

## 36. Production Activation Plan

**Prepared. Not executed.** Per market:

### Preconditions

B1–B4 cleared for that market. B5–B11 cleared (GCC-wide engineering). B12–B13
for UAE. Staging matrix passed on the exact SHA. Owner website acceptance
recorded for that market.

### Migration requirements

**None specific to activation.** All 67 migrations are additive and already
applied. Before any flag change: verify production migration state and
`/version` reports the expected SHA.

### Configuration

Compliance requirements configured from verified sources, and
`marketComplianceReadiness(market)` returns `ready`.

### The market flag

`enabled: false → true` in `shared/markets.ts`. **This is a code change,
reviewed and deployed like any other — not a runtime toggle.** The exact diff
will be presented before it is made.

### Deployment order

1. Deploy market-aware discovery, the compliance onboarding UI, the provider
   pricing UI and the admin approval surface — **with all markets still
   disabled**
2. Verify on staging
3. Deploy the flag change **separately**

Never bundle an unreviewed migration with an activation.

### Verification

See §38.

---

## 37. Rollback / Disable Plan

`enabled: true → false` and redeploy.

**Immediate effect:** the market cannot be selected; no new project, RFQ or
service offer can be created in it; `marketEligibility` reports
`market_disabled`; `mayManageOffer` refuses; `projects.changeMarket` refuses it
as a target.

### What disabling does NOT undo

Records already created in that market **persist** with their market and
currency. An RFQ raised against a project whose market is now disabled is
**refused** rather than re-denominated.

That refusal is correct — silently converting a live commercial relationship to
another currency would be far worse. But it means **disabling is not a clean
undo once commerce has happened**: it leaves existing projects and quotations
intact but strands new activity against them.

**This is itself an argument the owner should weigh in the activation-strategy
decision (§40, D4).**

Migrations are not rolled back; the image is. All money-column widenings are
lossless and backward compatible — the previous release reads them as strings
and parses them identically.

---

## 38. Post-Activation Verification

Using existing instrumentation only. No new monitoring infrastructure.

| Check | What a failure looks like |
|---|---|
| **Wrong currency** | any commercial row whose `currency` ≠ `currencyForMarket(marketCode)` |
| Failed RFQ creation | refusals from the market resolution path |
| Provider eligibility failures | approved providers not appearing in their own market |
| **Cross-market leakage** | a buyer seeing another market's providers or products |
| Precision errors | a three-decimal amount displaying or storing two |
| Compliance onboarding failures | providers unable to complete a market's requirements |
| Quotation failures | refused submissions, or a currency mismatch against the RFQ |
| **Unexpected fallback to Egypt** | `ImplicitMarketUnavailableError` in logs, or an EG row where another market was selected |
| Disabled-market bypass | any record in a market whose registry row is `enabled: false` |
| Localization defects | untranslated strings or broken RTL on the new flows |

### The single highest-value check

```sql
-- Any commercial row whose currency disagrees with its market
SELECT 'projects', id, marketCode, currency FROM projects
UNION ALL SELECT 'rfqs', id, marketCode, currency FROM rfqs;
-- then compare each against the registry
```

One query, and it catches the entire class of defect this workstream exists to
prevent.

---

## 39. Outstanding Evidence Gaps

1. **No official page was read for any country.** Every regulatory claim is
   DISCOVERED or UNVERIFIED.
2. **Egypt has no source at all** — not even a discovered URL, despite being
   the live market.
3. **Five UAE emirates unresearched.**
4. **What licenses private contracting in KW, BH and OM is unidentified** —
   only procurement-side schemes were found. **Oman matters most: it has a real
   affected user.**
5. **Individual vs firm regulation** unresolved across all six GCC markets.
6. **Credential expiry behaviour** unresearched and unmodelled.
7. **Kuwait's engineering discovery concerns offices, not individuals.**
8. **Project-specific thresholds** (value, type, floor count, municipality,
   grade) — BuildHub **cannot** evaluate per-project eligibility; the engine has
   no project attributes. Whether it needs them depends on B1.
9. **Supplier rules unresearched in every market** — the role most likely to be
   Layers A+B only, and the least investigated.
10. **Public procurement authorities not separately researched** for EG, SA
    or AE.
11. **§39 of the directive — `vendorMarketInterest` does not exist.** It was in
    the approved architecture and was never built. It therefore cannot become
    approval, discovery, matching, offer publication or quotation eligibility —
    guaranteed by **absence**, which is stronger than a test, but it is
    **absent, not implemented**. If pre-launch interest capture is wanted, it is
    new work.

---

## 40. Owner Decisions Required

Only decisions that cannot be determined from code, approved architecture, or
regulatory evidence.

### D1 — How is the compliance research actually performed?

**Why it matters:** B1 gates all seven markets, Egypt included, and it cannot be
done from this environment.

**Options:**
- **(a)** Allow the official domains for outbound fetch (`momah.gov.sa`,
  `tamm.abudhabi`, `pages.dmt.gov.ae`, `dm.gov.ae`, `hukoomi.gov.qa`,
  `monaqasat.mof.gov.qa`, `moci.gov.qa`, `e.gov.kw`, `bahrain.bh`,
  `moic.gov.bh`, `omanuna.oman.om`, plus Egypt's) — then each page is read,
  recorded with source and date, and configured.
- **(b)** You or a local advisor supply the official pages/documents; they are
  mapped in, with the evidence preserved as **yours** rather than claimed as
  personally fetched.
- **(c)** Engage local counsel per market for a formal applicability opinion.

**Consequence:** (a) is fastest and keeps provenance machine-recorded. (b)
works and is honest about who verified what. (c) is slowest and strongest for
liability — and is the only option that reliably answers the *applicability*
questions, which are legal judgements rather than page-reading.

### D2 — Egypt's existing requirements: law or BuildHub policy?

**Why it matters:** `bank_certificate`, `insurance_certificate`, `portfolio` and
`product_catalogue` look like trust requirements. Labelling them
`legal_requirement` tells a provider a government demands them. The live product
may be doing this now.

**Options:**
- **(a)** Research Egypt properly and label from evidence.
- **(b)** Provisionally re-label the plausible ones `buildhub_policy` now, and
  research the rest.
- **(c)** Leave as-is.

**Consequence:** (c) means continuing to present BuildHub policy as law — the
specific thing the directive prohibits. (b) is honest immediately but changes
live Egyptian onboarding copy, which the directive says not to do silently —
so it needs your explicit instruction.

### D3 — Does BuildHub ask for emirate of work?

**Why it matters:** UAE compliance differs by emirate, so without it BuildHub
cannot resolve an Emirati provider's applicable requirements at all.

**Options:**
- **(a)** Capture emirate as part of work location, shown only when the market
  is AE.
- **(b)** Derive it from a city/address field.
- **(c)** Capture at provider onboarding rather than per project.

**Consequence:** (a) is explicit and adds one step for AE only. (b) is free-text
inference, which this architecture rejects everywhere else for good reason.
(c) separates provider jurisdiction from work jurisdiction, which may be wrong
for cross-emirate work.

### D4 — Simultaneous or staged activation?

**Why it matters:** it changes blast radius and operational load. **Readiness is
currently identical across all six** — same blockers, same evidence state — so
this is an operational and commercial choice, not a readiness-driven one. I will
not rank the markets.

**Simultaneous:** one deploy, one acceptance pass, one monitoring window. A
cross-market discovery defect affects all six at once. §37 shows disabling is
not a clean undo once commerce has started.

**Staged:** each market gets its own acceptance and monitoring window; defects
are contained to one market; six deploys and six acceptance passes; markets go
live at different times, which has commercial consequences only you can weigh.

### D5 — GCC providers and EGP-only billing

**Why it matters:** a Saudi or Emirati supplier would transact in SAR/AED and
pay BuildHub in EGP, carrying the FX exposure.

**Options:**
- **(a)** Launch GCC commerce with EGP billing and state it plainly.
- **(b)** Hold GCC activation until multi-currency billing exists.
- **(c)** Offer GCC providers a free or deferred subscription period until
  billing supports their market.

**Consequence:** (b) couples commercial expansion to a payment-provider
workstream that does not exist and is owner-deferred. (a) is viable and visibly
odd. Billing is not redesigned in this report.

### D6 — Does BuildHub need per-project eligibility?

**Why it matters:** if a jurisdiction requires a classification grade by project
value, provider-level approval is insufficient and the engine needs project
attributes it does not have.

**Options:** **(a)** defer until B1 shows whether any market requires it;
**(b)** build the dimension now.

**Consequence:** (b) is speculative and directive §27 says not to add fields
speculatively. (a) risks discovering late that a market needs it.

### D7 — Is pre-launch market interest wanted at all?

**Why it matters:** `vendorMarketInterest` was in the approved architecture and
was never built. Its absence is currently a safety property.

**Options:** **(a)** build it as an informational capture; **(b)** drop it from
the architecture and record that decision.

**Consequence:** (a) is new work with a strict guarantee to maintain (interest
must never become eligibility). (b) removes a documented-but-absent component
from the plan so it stops reading as a gap.

---

## 41. Final Release State

```
FINISHING RELEASE
  CODE / RELEASE-GATE ........ PASS      d4fa871c (in main as cc4b1ed, empty diff)
  DEPLOYED / STAGING ......... BLOCKED
  OWNER WEBSITE ACCEPTANCE ... OPEN
  PRODUCTION ................. live (pre-RC build)

GCC WORKSTREAM
  Phase 0  money + denomination ....... COMPLETE   e20653f
  Phase 1  provider market identity ... COMPLETE   89c7998
  Phase 2  market service offers ...... COMPLETE   61eb4fd
  Phase 3  work location + predicate .. COMPLETE   87bd262
  Compliance architecture ............. COMPLETE   5faf9e2
  Report findings + 2 guards .......... COMPLETE   f6d21be   <- HEAD

  GCC ENGINEERING .................... INCOMPLETE  B2,B3,B5-B11
  GCC COMPLIANCE DATA ................ ABSENT      B1 - all 7 countries
  GCC STAGING ........................ BLOCKED     B14,B16
  GCC OWNER ACCEPTANCE ............... PENDING     B17
  PRODUCTION ACTIVATION .............. NOT AUTHORIZED

MARKETS
  EG ......... enabled
  SA AE QA KW BH OM ...... registered, disabled, ACTIVATION BLOCKED

CONTEXTUAL AI A1-A8 ................. HOLD

GATE   233 test files | 5204 tests | typecheck green | build green
       67 migrations from empty | local == remote | working tree clean
```

**Nothing in this report has been converted into a production requirement.** The
sequence remains: research → evidence → applicability determination → owner
review → approved configuration → tests → staging → owner website acceptance →
production activation authorization.
