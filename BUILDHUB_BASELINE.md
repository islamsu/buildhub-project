# BuildHub Baseline — August 18, 2026

**Build Version:** v1.8 (Baseline Frozen)  
**Environment:** Production-ready code, external configuration pending  
**Test Status:** 38 / 38 tests passing (0 failed, 0 skipped)  
**TypeScript Status:** 0 errors  
**Production Build:** Successful (`vite build`)  

---

## 1. Project Overview & Business Purpose

BuildHub is an AI-powered Construction Operating System that connects homeowners, contractors, engineers, architects, interior designers, labor, vendors, manufacturers, and suppliers into one intelligent ecosystem managing the entire construction journey—from planning and design to procurement, execution, maintenance, and renovation.

### User Roles
- **Customer / Homeowner:** Plans projects, creates RFQs, compares vendor quotations, manages contracts, and reviews completed work.
- **Contractor / Engineer / Architect / Supplier / Vendor:** Submits compliance legal documents, undergoes admin review, lists catalogs/services, receives RFQs, and submits competitive quotations.
- **Admin / Super Admin:** Manages user roles, compliance queues, dispute resolutions, account freezing with reason codes, audit trails, and system settings.

---

## 2. Technology Stack

| Layer / Concern | Technology & Version |
| :--- | :--- |
| **Frontend Framework** | React 19 with Vite |
| **Styling & UI** | Tailwind CSS v4, Radix UI primitives, Lucide icons |
| **Backend Framework** | Express 4 running on Node.js 22 |
| **API Layer** | tRPC 11 (End-to-end type safety) |
| **Database & ORM** | MySQL / TiDB accessed via Drizzle ORM |
| **Authentication** | Manus OAuth for real users, scrypt password hashing for admin-created dummy users |
| **File Storage** | Manus S3-backed storage proxy with MIME/size validation |
| **Testing Framework** | Vitest v2.1.9 |
| **Language** | TypeScript (strict mode) |

---

## 3. Application Architecture

BuildHub follows a monorepo client-server architecture:
- **Client (`client/src/`)**: React SPA with wouter routing, tRPC React hooks, and Tailwind styling supporting dynamic LTR/RTL switching (English/Arabic).
- **Server (`server/`)**: Express middleware handling tRPC routers (`server/routers.ts`), database helpers (`server/db.ts`), and secure transaction workflows (`server/quotationWorkflow.ts`).
- **Database (`drizzle/schema.ts`)**: Relational MySQL schema defining users, RFQs, quotations, disputes, messages, notifications, reviews, subscriptions, and audit logs.

---

## 4. Quotation Workflow & Concurrency

- **State Machine:** `PENDING → ACCEPTED`, `PENDING → REJECTED`, `PENDING → WITHDRAWN`, `PENDING → EXPIRED`.
- **Concurrency Protection:** Quotation acceptance is wrapped in an atomic database transaction (`acceptQuotationSecure` in `server/quotationWorkflow.ts`) that re-verifies RFQ and quotation status before updating, preventing double-acceptance or race conditions.

---

## 5. External Services & Production Requirements

| Service | Purpose | Current Status | Production Requirement |
| :--- | :--- | :--- | :--- |
| **Stripe** | Subscriptions & payments | Implemented in code | Live API keys & webhooks required |
| **S3 Storage** | File uploads & documents | Fully functional | Configured via environment |
| **OpenAI** | AI assistant & estimation | Server-side adapter ready | API key required |
| **Email/SMS** | Notifications | Backend triggers active | SendGrid/Twilio credentials required |
| **Database Backups** | Disaster recovery | Documented | Cloud provider snapshot cron required |

---
*BuildHub baseline frozen and documented. No intentional functional changes were made.*
