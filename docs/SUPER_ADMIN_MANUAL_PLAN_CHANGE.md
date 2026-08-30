# Super Admin manual plan / membership change

## Why it exists

Every route into a paid plan in the billing engine started from a payment, and
BuildHub has no payment provider:

| Route | Why it could not serve this |
|---|---|
| `changeVendorPlan` | requires live paid access to change **from** |
| `startPaidTrial` | spends the vendor's one lifetime trial, and is a trial |
| `activate` | needs a plan already chosen |

So a vendor on FREE who had agreed a deal off-platform - a bank transfer, a
goodwill month, a negotiated contract - could not be given the plan by anybody.
The only remaining lever was a database console: no reason recorded, no audit
trail, no notification, no row lock.

`AdminVendorBilling.tsx` previously said the lifecycle mutations were
deliberately unexposed because buttons "invite exactly the kind of unaudited
manual plan-granting the lifecycle was built to prevent". That was right about
the danger and wrong about the remedy. The answer to an unaudited grant is to
make the grant auditable.

## What happens, by case

The engine decides; the router only reports. Every branch runs inside the same
`SELECT ... FOR UPDATE` lock as every automatic transition.

| Vendor's state | Admin selects | What the engine does |
|---|---|---|
| FREE / lapsed | professional or premium | **grants** paid access (`grantPaidAccess`) |
| paid, live | a different paid plan | `changePlan` - period and price rules unchanged |
| paid, live | the plan they already have | **no-op** - nothing written, nobody notified |
| paid, live | FREE | `cancelAtPeriodEnd` - **scheduled**, not revoked |
| paid plan, lapsed | FREE | `downgradeToFree` - nothing live to revoke |
| FREE | FREE | no-op |

## Three things a grant deliberately does NOT do

Each would state a commercial fact that is not true.

- **`priceAmount` is `0.00`**, not the catalogue price. The vendor agreed to pay
  nothing. That column exists to record what a vendor actually agreed to pay,
  and stamping 899.00 on a comped grant would corrupt exactly that.
- **`trialStartedAt` is untouched.** A grant is not a trial. Spending the
  vendor's single lifetime trial as a side effect of an administrator's
  goodwill would quietly cost them something they never used.
- **Founder columns are untouched.** A grant neither awards the one-time
  founder offer nor burns it.

It also never touches `users.userRole`. A membership is a subscription; every
entitlement check in the codebase reads the subscription, so a role edit would
grant nothing while corrupting the account.

## Usage and history are preserved

`qualifiedEnquiries` rows are never written by this path. A vendor who has used
7 of 20 this month and is moved to a 50-lead plan has **43 remaining, not 50**.
Consumption already recorded is consumption the vendor already acted on.

`billingEvents` is appended to, never rewritten, so plan history survives every
change.

## Who may do it

`billing.manage`, which **SUPER_ADMIN** and **BILLING_ADMIN** hold. USER_ADMIN,
MARKETPLACE_ADMIN and SUPPORT_ADMIN do not, and are refused by the server -
verified live, not by hiding the button.

This reads the existing role model rather than adding a rule: granting a plan
is a billing operation, and the role whose purpose is billing already carries
the permission to perform one.

## The three records, and the reason

A reason is **required**, enforced twice (input schema and engine).

| Table | Answers |
|---|---|
| `billingEvents` | what the engine did, with the reason in the note |
| `userAccountAuditEvents` | what an administrator did, to whom, and why |
| `fieldValueHistory` | `plan: free -> premium`, with the reason on the row |

The analytics stream records `subscription.plan_changed`. It must never record
a **renewal**: a comped plan counted in the renewal KPI is revenue nobody paid.
That was a real defect - the new action fell through to a default branch that
reads `free -> active` as a renewal - and it has its own test.

## The notification

Worded from what actually happened, in the reader's own language:

| Outcome | Key |
|---|---|
| moved to a higher plan | `notif.billing.plan.upgraded` |
| moved to a lower plan | `notif.billing.plan.downgraded` |
| FREE selected while paid | `notif.billing.plan.scheduled` |

The plan name is **never** written into the row as prose. `messageParams`
carries `planKey: 'billing.plan.premium'`, and the reader's client resolves it
through the same `t()` as the sentence around it - so an Arabic-speaking vendor
reads an Arabic plan name. Verified live in both languages.

Every notification deep-links to `/settings#settings-billing`, the section
itself rather than the top of the page.

**A no-op notifies nobody.** Selecting the plan a vendor already has writes no
audit event and sends no message.

## AMBIGUITY: a plan change does not reverse a pending cancellation

**Current behaviour.** If a vendor has cancelled (`cancelAtPeriodEnd = true`)
and an administrator then moves them between paid plans, the cancellation
**stands**. The live run shows this as `Changed to professional. State:
CANCELLATION_SCHEDULED`.

**Why it is this way, and why it was not changed.** `changePlan` alters the
plan and nothing else. Clearing the cancellation would re-commit the vendor to
a renewal payment they had explicitly cancelled, which is a commercial decision
no administrator made by choosing a plan from a dropdown. `resumeSubscription`
exists for reversing a cancellation, and it is a separate, deliberate act.

**Recommended behaviour.** Leave as is. The admin screen already displays
`CANCELLATION_SCHEDULED` in the result line, so the state is disclosed rather
than hidden.

**Owner decision required** only if the business wants a manual plan change to
imply resumption. That would need to be stated, not assumed.

## Evidence

`evidence/zg-planchange.mjs` - **48/48, run twice**, real browser, real
MariaDB. Every positive assertion checks the database, not a toast.

41 unit tests. 18 mutations, 17 killed. The single survivor is honest: widening
the permission from `billing.manage` to `billing.read` changes the answer for
no existing administrator, because no role holds read-only billing. A test now
fails the day one does.
