# BuildHub — Reachability Census (§6)

**The question is not "does the procedure exist?". It is "can a legitimate
journey get to it?"**

Re-derived 22 September against `claude/buildhub-global-release-candidate`.
Reproduce with `node scripts/reachability-census.mjs`.

---

## Why this exists

Three capabilities shipped looking finished and were unreachable:

- `adminAttention` computed a name-change count **no screen rendered**. The
  owner reported the queue as missing; it was computed into a void.
- `projects.update` accepted `spent`, a column **no UI ever sent** and the
  dashboard then summed — so "Total Spent" was structurally EGP 0.
- Two Q&A moderation procedures had **no client caller** until the reachability
  test refused them.

All three pass any test that asks "does the endpoint work". None of them was a
product.

---

## What the census measures

| Layer | Question | Instrument |
|---|---|---|
| Procedure | Does any reached client file call it? | `server/reachability.test.ts` (import graph from the entry point) |
| Route | Does any **route** reach the file that calls it? | `scripts/reachability-census.mjs` |
| Field | Does any client file **read the value** it returns? | same script |

The route layer follows **wrapper components** — `/products/new` renders
`NewProductPage`, a one-line function that renders `<ProductFormPage>`. The
first version stopped at the component name and reported the product form
unreachable. A marketplace where suppliers cannot list anything would be a P0,
so a census that invents one is worse than no census.

The field layer reads **client files only**. The import graph legitimately
leaves `client/src` — `lib/trpc.ts` imports the `AppRouter` *type* from
`server/routers.ts` — so the naive version concatenated the server's own source
into "what the client mentions". Every field matched its own declaration and the
census reported zero findings forever. **Caught by planting a field nothing
reads and watching the census not see it.** A census never shown to detect the
thing it looks for is not evidence of anything.

---

## Result

```
procedures = 281   called = 273   uncalled = 8
routes: 0 procedures whose caller no route reaches
fields: 7 returned and never read client-side
```

### Procedures with no caller — 8, all declared

Every one is in `server/reachability.ts` with a written reason: the QA
sign-in whose UI entry point was deliberately removed, and seven
payment-provider writes that have no provider to fire them. Wiring a button to
any of the seven would let an administrator record revenue BuildHub never
received.

**The namespace is the MOUNT name, not the variable name.** `registrationRouter`
is mounted as `compliance`, so the client calls `trpc.compliance.*`. The first
version read the variable name and reported the two procedures a professional
uploads their registration documents through as having no caller at all. A
census that mislabels a namespace invents dead code, which is the one thing it
must never do. It now agrees exactly with `server/reachability.test.ts`.

### Fields returned and never read — 7, classified

| Field | Class | Decision |
|---|---|---|
| `admin.addUserNote.noteId` | DOMAIN-INTERNAL | Keep. A mutation returning the id it created is ordinary; the client refetches. |
| `admin.addEnquiryNote.noteId` | DOMAIN-INTERNAL | Keep, same. |
| `admin.assignEnquiry.assignmentId` | DOMAIN-INTERNAL | Keep, same. |
| `admin.setVendorEnquiryLimit.overrideId` | DOMAIN-INTERNAL | Keep, same. |
| `rfq.submitQuotation.deduplicated` | FALSE POSITIVE | Consumed inside `routers.ts` by the procedure that wraps it; it never crosses the wire. The census slices procedure bodies and sees the inner helper's return. |
| `disputes.subjectParties.yourRelation` | INTENTIONALLY RESERVED | The viewer's relation to the subject. `candidates` is already derived from it server-side, so the screen needs nothing more today. Left in place, recorded here. |
| `auth.checkSignupAvailability.emailAvailable` | **FIXED** | Was `!emailUser`, which is `true` when no email was supplied — and the only caller sends a username alone, so it reported every address on earth as available. Now `null` when nothing was asked. "I did not check" and "it is free" are different answers. |

### Removed

`rfq.requesterContact.contactUnlocked` — said the same thing as `contact !==
null`, which the screen already reads. Two signals for one fact is how they
come to disagree.

---

## The one real finding: `myProjectRole`

Returned by five procedures and read by nothing. Its own comment said why it
existed: *"the caller's own capacity travels with the record so the UI can
render the right controls."* The UI never used it.

So a member added to a project as a **viewer** was shown the status dropdown,
the Expenses section and Add Expense. The server refused every one — correctly.
**The authorization was sound; the screen was lying.**

Exactly the `projects.spent` shape: a value computed for a purpose that never
materialised, invisible to every test that asks whether the endpoint works.

**Fixed** by deriving one capability set on the page from the shared matrix
(`capabilitiesFor`) and gating every control on it — including the team tab,
which had grown its own copy from `projects.members.myCapabilities`. Hiding a
control the server would refuse is about not lying to the person; every
procedure still checks for itself.

**Evidence:** `evidence/zg-projectcapability.mjs` — 9/12 before, 12/12 after,
mutation-tested.

The probe's first version passed vacuously: it measured Add Expense without
opening the Expenses tab, and Radix renders only the active tab. The **owner
control caught it** — the owner could not see the controls either, because
nobody can see a closed tab. A check that cannot tell "hidden by role" from
"not rendered yet" is measuring the wrong thing.

---

## What this census cannot decide

Whether a control inside a reached file is **rendered, enabled and clickable**
for a given role. Static analysis cannot answer that, and a census claiming to
would be the "grep sees import" reasoning §5 rules out. This produces the
**shortlist**; anything on it is confirmed in a real browser before it is
called a finding — which is how `myProjectRole` became a fix and
`marketplace.create` was correctly dropped as a false alarm.
