# Payments Setup (Stripe)

How to get subscriptions working end to end. Do this in **Stripe Test mode**
first, then repeat in **Live mode** for production.

The app has two paid tiers:

| Tier | Price | Limit |
|------|-------|-------|
| Avid Listener (`avid`) | $3/month, $30/year | 100 searches/month |
| Eat, Breath, Music (`unlimited`) | $5/month, $50/year | unlimited searches |

---

## Step 1 — Get your secret key

1. **dashboard.stripe.com** → toggle **Test mode** ON (top right).
2. **Developers → API keys** → copy the **Secret key** (`sk_test_...`).

## Step 2 — Create the 4 prices

**Product catalog → Add product**, create two products:

- **Avid Listener** → add a **$3/month** recurring price and a **$30/year** recurring price.
- **Eat, Breath, Music** → add a **$5/month** and a **$50/year** recurring price.

Open each price and copy its **price ID** (`price_...`). You'll have four.

> Checkout charges the correct amount even without these (the amount comes from
> code). But setting them silences the startup warning and keeps plan switches
> clean. Recommended.

## Step 3 — Webhook (the critical part)

This is how the app learns when a subscription renews, downgrades, or ends.
**Without it, renewals and end-of-period transitions never reach the database.**

1. **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:** `https://YOUR-RENDER-BACKEND-URL/api/payments/webhook`
3. **Select events** — add exactly these three:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save → **Reveal** the **Signing secret** → copy it (`whsec_...`).

## Step 4 — Put everything in Render

Render → **backend service → Environment**:

| Key | Value |
|-----|-------|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_AVID_MONTHLY` | `price_...` |
| `STRIPE_PRICE_AVID_YEARLY` | `price_...` |
| `STRIPE_PRICE_UNLIMITED_MONTHLY` | `price_...` |
| `STRIPE_PRICE_UNLIMITED_YEARLY` | `price_...` |
| `FRONTEND_URL` | your site, e.g. `https://www.hum.rocks` |

Save → Render redeploys.

## Step 5 — Test once

On the live site, log in and subscribe. Stripe test card:
**`4242 4242 4242 4242`**, any future expiry, any CVC, any ZIP.

Verify:

1. **Subscribe** → your account shows the new tier (proves checkout + webhook).
2. **Upgrade** (avid → unlimited) → Stripe shows an invoice for only the
   prorated difference, applied immediately.
3. **Downgrade** (unlimited → avid) → Stripe shows a **subscription schedule** on
   that subscription with avid starting next period; no refund. Tier flips at
   period end.
4. **Cancel** → the subscription shows **"Cancels on \<date\>"** (not gone); you
   keep your tier until then, then drop to free. No refund.

## Step 6 — Go live

Flip Stripe to **Live mode**, redo Steps 1–4 with **live** values (`sk_live_...`,
new live price IDs, a new live webhook + its `whsec_...`). Update the same vars
in Render.

---

## Billing behavior (how it's designed)

- **Upgrade** (cheaper → pricier): immediate. Stripe prorates — the customer pays
  only the difference, unused time on the old plan is credited.
  (`proration_behavior: 'always_invoice'`)
- **Downgrade** (pricier → cheaper): **no refund**. A subscription schedule keeps
  the current plan until period end, then rotates to the cheaper plan.
- **Cancel**: **no refund**. `cancel_at_period_end` — the customer keeps their
  tier until the period ends, then the `customer.subscription.deleted` webhook
  downgrades them to free.

## Gotcha: subscription schedules block direct changes

A scheduled **downgrade** attaches a Stripe *subscription schedule* to the
subscription. While that schedule is attached, Stripe **rejects** direct
cancellation and direct item updates with:

> "The subscription is managed by the subscription schedule `sub_sched_...`, and
> updating any cancelation behavior directly is not allowed."

The code handles this: both the **cancel** and **upgrade** paths call
`releaseSubscriptionSchedule()` first, which detaches the schedule (keeping the
current price) and drops the pending downgrade, then proceeds. If you add new
code that touches a subscription, release any attached schedule before
`stripe.subscriptions.update(...)`.

## Troubleshooting

- **Toast: "Failed to cancel subscription with Stripe"** → check **Render → Logs**
  for the line starting `Stripe cancellation error:`. The real Stripe message is
  there (and is now also returned to the toast).
- **"No such subscription"** → test/live mismatch. The subscription was created
  with a different mode/key than the one currently in Render. Make sure the
  secret key, price IDs, webhook secret, and the subscription you're testing are
  all in the **same** mode.
- **"Invalid API Key"** → `STRIPE_SECRET_KEY` in Render is wrong or has a stray
  space.
- **Subscribed but tier didn't update** → the webhook isn't reaching the backend.
  Recheck Step 3 (URL, the three events, and `STRIPE_WEBHOOK_SECRET`). Stripe's
  webhook page shows delivery attempts and failures.

## Code map

- Checkout / upgrade / downgrade: `POST /api/payments/create-checkout-session`
- Cancel: `POST /api/payments/cancel-subscription`
- Status (drives "active until \<date\>"): `GET /api/payments/status`
- Webhook: `POST /api/payments/webhook`
- Plan config (prices, names): `SUBSCRIPTION_PLANS` in `backend/server.js`
