# BuildHub Production Checklist

**Target Baseline:** August 18, 2026  
**Status:** Code Ready, External Configuration Required  

---

## Pre-Publish Checklist

- [ ] Configure live Stripe API keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) in Management UI Settings -> Secrets.
- [ ] Test production payment flow and webhook handling in live Stripe mode.
- [ ] Configure automated daily database snapshot retention in the cloud hosting provider console.
- [ ] Perform a staging database restore drill to verify recovery procedures.
- [ ] Configure live email provider credentials (SendGrid / SMTP) for notifications.
- [ ] Configure live SMS provider credentials (Twilio) if SMS alerts are required.
- [ ] Configure production analytics tracking pixels.
- [ ] Configure uptime monitoring (e.g., UptimeRobot, Pingdom).
- [ ] Configure error monitoring (e.g., Sentry).
- [ ] Verify production environment variables and database SSL connections.
- [ ] Verify no test/demo credential bypasses are active in production.
- [ ] Run final test suite (`pnpm test`).
- [ ] Run production build (`pnpm run build`).
- [ ] Publish application via Management UI Publish button.
- [ ] Verify production URL accessibility and DNS binding.
- [ ] Verify production database connectivity and migration integrity.
- [ ] Verify production subscription charge.
- [ ] Verify email/notification delivery.

---
*BuildHub baseline frozen and documented. No intentional functional changes were made.*
