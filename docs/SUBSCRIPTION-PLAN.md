# Subscription tiers — planning draft

Work with product owners to finalize pricing and entitlements. This document tracks decisions before implementation.

## Proposed tiers (draft)

| Tier | Audience | Draft benefits |
|------|----------|----------------|
| **Free** | Small teams trying RetroBoard | Limited boards, basic templates, standard support |
| **Team** | Department / squad | More boards, custom columns, invite links, email support |
| **Enterprise** | Multi-company / masters | Unlimited boards, audit exports, SSO (future), SLA |

## Technical approach (when ready)

1. **Billing provider** — Stripe Billing (subscriptions + Customer Portal) or Paddle for tax handling.
2. **Data model** — `subscriptions` table: `user_id` or `company`, `plan`, `status`, `stripe_customer_id`, `current_period_end`.
3. **Enforcement** — middleware `requirePlan('team')` on create-board, GIF library size, etc.
4. **Frontend** — plan badge in profile, upgrade CTA, grace period messaging.
5. **Webhooks** — `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_failed`.

## Open questions

- Bill per **company** or per **user**?
- Grandfather existing OpenEye users?
- Trial length and whether masters bypass limits?

## Cost notes

- Stripe: ~2.9% + $0.30 per successful charge (US); Billing adds ~0.5% for recurring.
- Estimate monthly infra + email + tunnel before setting retail price.
