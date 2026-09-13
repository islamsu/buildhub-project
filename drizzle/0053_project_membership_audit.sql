-- ── PROJECT MEMBERSHIP BECOMES AN AUDITABLE SUBJECT ────────────────────────
--
-- Adding somebody to a project, changing their capacity on it, or taking them
-- off it changes WHO CAN READ THE CUSTOMER'S DOCUMENTS, RFQs and quotations.
-- None of it was recorded anywhere: no commercial event, no field history.
-- "Who let the other contractor see our drawings, and when" had no answer.
--
-- `subjectType` is a MySQL enum, so widening the TypeScript union alone
-- compiles and then fails at the database on the very first membership change.
-- The enum is widened here, in the same change.
ALTER TABLE `commercialAuditEvents`
  MODIFY COLUMN `subjectType`
  enum('rfq','quotation','product','document','enquiry','message','category','service','project')
  NOT NULL;
