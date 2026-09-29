-- ── A SUPPLIER CAN TAKE THEIR OWN PRICE OFF THE TABLE ─────────────────────
--
-- `quotations.status` offered pending, accepted and rejected. All three are
-- the CUSTOMER's decision: a bid wins, or it loses because another one won.
-- The supplier had no exit at all. A firm whose material costs moved, or whose
-- capacity went, could only revise to a number nobody would accept - which is
-- not a withdrawal, it is a worse bid, and it leaves a price on the board that
-- the customer may still accept and hold them to.
--
-- The gap was visible in the code before it was visible in the product:
-- commercialAudit has carried 'quotation_withdrawn' in its action vocabulary
-- since it was written, and nothing could ever record it.
--
-- WITHDRAWN IS TERMINAL AND IT IS THE SUPPLIER'S ALONE. Only a pending
-- quotation may be withdrawn: an accepted one is an agreement, and walking
-- away from an agreement is a dispute rather than a state change.
--
-- The enum is widened here, in the same change as the TypeScript union, for
-- the reason 0053 gives - widening the union alone compiles and then fails at
-- the database on the first withdrawal.
ALTER TABLE `quotations`
  MODIFY COLUMN `status`
  enum('pending','accepted','rejected','withdrawn')
  DEFAULT 'pending';
