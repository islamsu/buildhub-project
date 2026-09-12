-- ── A reward records WHAT IT CREATED ───────────────────────────────────────
--
-- A referral reward's effect is a row somewhere else - an entitlement override,
-- or a placement booking. Nothing connected the two, so reversing a reward
-- meant finding its effect by matching the reason text, which works right up
-- until two campaigns share a name or an administrator edits one.
--
-- `effectRef` is that link, written the moment the effect commits:
--
--   OVERRIDE:123    the vendorEntitlementOverrides row this bonus created
--   PLACEMENT:45    the vendorSponsorships row this Spotlight created
--
-- Deliberately a string rather than two nullable foreign keys. The reward types
-- point at different tables, a FK would make an audit-shaped row block the
-- deletion of what it describes, and the value is only ever read back by the
-- reversal that wrote it.
--
-- FORWARD-ONLY and nullable: every existing reward row keeps working, and a
-- null means "granted before this column existed, or never applied".

ALTER TABLE `referralRewards`
  ADD COLUMN `effectRef` varchar(64) NULL;
