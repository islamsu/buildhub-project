-- ── Referral campaigns become resolvable, deterministically ────────────────
--
-- THE ENGINE HAS NEVER FIRED. `referrals.campaignId` is read by
-- server/referralEngine.ts on every qualification attempt and NOTHING HAS EVER
-- WRITTEN IT: the signup insert omits it and no other writer exists. Every
-- referral short-circuits at 'no campaign', so no reward has ever been granted
-- by the product.
--
-- The owner's decision is LATE BINDING AT QUALIFICATION: no campaign is chosen
-- at signup, and one is resolved when a real qualifying event fires. That needs
-- two facts the campaign table does not carry.
--
-- priority                THE SAME INPUT MUST ALWAYS SELECT THE SAME CAMPAIGN.
--                         With several eligible campaigns and no declared
--                         order, resolution would depend on whatever order the
--                         database returned rows in - which is not a decision,
--                         it is a coin toss that nobody can reproduce when a
--                         vendor asks why they got one reward and not another.
--                         Higher wins; id breaks a tie, so the answer is total.
--
-- attributionWindowDays   How long after signup a referral can still qualify.
--                         Without it a two-year-old signup earns a reward the
--                         moment somebody finally verifies their email, which
--                         is not what "campaign" means to whoever budgeted it.
--                         Defaulted to 90 rather than left null, because a null
--                         window is an unbounded liability by omission.
--
-- FORWARD-ONLY and additive: both columns take a default, so every existing
-- campaign row keeps working and gets the same defaults a new one would.

ALTER TABLE `referralCampaigns`
  ADD COLUMN `priority` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `referralCampaigns`
  ADD COLUMN `attributionWindowDays` int NOT NULL DEFAULT 90;
--> statement-breakpoint
-- Resolution reads active campaigns by qualification type on every qualifying
-- event; without this it is a full scan of the table per event.
CREATE INDEX `referralCampaigns_resolution_idx`
  ON `referralCampaigns` (`status`, `qualificationType`, `priority`);
