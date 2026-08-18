# BuildHub Senior Developer & Claude Code Handoff Notes

**Baseline Version:** August 18, 2026  
**Status:** Frozen Baseline  

---

## 1. Safe Development Areas
- **Frontend Pages (`client/src/pages/`)**: Adding new UI components, styling refinements, and widget enhancements.
- **Client Components (`client/src/components/`)**: Reusable UI components and layout widgets.
- **New tRPC Routers (`server/routers/`)**: Adding standalone routers for secondary features without modifying core authentication or quotation schemas.

---

## 2. Do Not Change Without Review
- **Database Schema (`drizzle/schema.ts`)**: Modifying existing columns or tables risks breaking existing user accounts, compliance queues, and audit trails.
- **Authentication & Authorization (`server/_core/` and middleware)**: Modifying OAuth, session cookies, or `adminProcedure` guards risks introducing severe security vulnerabilities.
- **Quotation State Machine & Concurrency (`server/quotationWorkflow.ts`)**: Altering `acceptQuotationSecure` transactions risks introducing double-acceptance race conditions.
- **Storage Authorization (`server/storage.ts`)**: Modifying S3 proxy upload/download validation risks exposing private compliance documents.

---

## 3. Critical Business Rules
1. **Dummy User Isolation:** Dummy/test users must remain excluded from business metrics, analytics, and reports unless explicitly requested.
2. **Quotation Exclusivity:** Accepting a quotation automatically closes competing quotations for that RFQ.
3. **Compliance Gating:** Non-individual professional users must not access bidding workflows until administrative compliance approval is granted.

---

## 4. Testing & Deployment Requirements
- **Automated Tests:** Always run `pnpm test` and verify that all 38 tests pass before committing or proposing changes.
- **TypeScript Check:** Always run `pnpm run check` (`tsc --noEmit`) to verify zero type errors.
- **Production Build:** Always run `pnpm run build` to confirm clean asset bundling.

---
*BuildHub baseline frozen and documented. No intentional functional changes were made.*
