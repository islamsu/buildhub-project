-- ── THE PAIR LOOKUP THAT NOW RUNS ON EVERY MESSAGE ───────────────────────
--
-- messages.send asks one question before it writes: have these two ever
-- spoken? Only a FIRST approach counts against the new-conversation limit, so
-- an established thread is never charged for how many threads came before it.
--
-- The table had single-column indexes on senderId and receiverId. Either one
-- narrows to a person's own correspondence, which for an active account is
-- every message they have ever sent - and the check runs on every send, so
-- the cost grows with the account's own history. That is the shape of a
-- problem that does not show up until the busiest users have it.
--
-- Two composite indexes rather than one, because the question is asked in
-- both directions: a vendor replying to a customer who wrote first is
-- continuing a conversation, not starting one, and the reply reads the pair
-- the other way round.
--
-- ADDITIVE AND REVERSIBLE. No column changes type, nothing is dropped, and no
-- row is rewritten; the existing single-column indexes are left in place
-- because other queries still lead with them.

CREATE INDEX `messages_sender_receiver_idx` ON `messages` (`senderId`, `receiverId`);
--> statement-breakpoint
CREATE INDEX `messages_receiver_sender_idx` ON `messages` (`receiverId`, `senderId`);
