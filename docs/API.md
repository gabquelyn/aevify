# Aevify API

Base URL: your app's URL, e.g. `http://localhost:3000` locally or your Vercel domain.

All responses are JSON. Amounts are **decimal strings** in tUSD8 (6 decimals), e.g. `"25.00"`,
with the exact on-chain value in `amountBaseUnits` (`"25000000"`).

Errors always look like:

```json
{ "error": { "type": "invalid_request", "message": "amount: must be greater than 0 ...", "param": "amount" } }
```

| Status | `type` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad input; `param` names the field |
| 401 | `authentication_required` | Missing, invalid or revoked key / not signed in |
| 404 | `not_found` | No such object (or it belongs to another merchant) |
| 409 | `conflict` | e.g. Idempotency-Key reused with different parameters |
| 409 | `merchant_not_ready` | Connect a payout wallet in the dashboard first |
| 502 | `chain_error` | An on-chain step failed; safe to retry |
| 503 | `service_unavailable` | Server not configured (database or chain settings) |

---

## Keys

| Key | Where | Used for |
|---|---|---|
| Secret key `sk_test_…` | Your **server** only | Creating and reading payments |
| Publishable key `pk_test_…` | Safe in the browser | Identifying your store in `@aevify/react` (coming soon) |

Create keys in the dashboard. A secret key is shown **once**; Aevify stores only its hash.
Send it as `Authorization: Bearer sk_test_...`.

---

## Payments

### Create a payment

`POST /api/v1/payments`

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Authorization: Bearer $AEVIFY_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1042" \
  -d '{ "amount": "25.00", "orderId": "1042", "description": "Coffee beans" }'
```

| Field | Type | | |
|---|---|---|---|
| `amount` | string | required | Up to 6 decimals, > 0, at most 1,000,000 |
| `orderId` | string | optional | Your reference, ≤ 128 chars |
| `description` | string | optional | Shown at checkout, ≤ 500 chars |
| `expiresInSeconds` | integer | optional | 60–3600, default 900 (15 min). The contract rejects payment after this. |
| `payer` | address | optional | Only this wallet may pay (e.g. a specific AI agent) |
| `successUrl`, `cancelUrl` | URL | optional | Where the hosted checkout sends the customer |
| `metadata` | object | optional | Up to 20 string key/values |

**Idempotency:** with an `Idempotency-Key` header, retrying the same request returns the
original payment (`200`, header `Idempotent-Replayed: true`) instead of creating a new one.
Reusing the key with different parameters returns `409`.

Response `201`:

```json
{
  "id": "pay_7Hq2…",
  "object": "payment",
  "status": "created",
  "amount": "25.00",
  "amountBaseUnits": "25000000",
  "currency": "tUSD8",
  "fee": null,
  "refunded": "0.00",
  "orderId": "1042",
  "description": "Coffee beans",
  "metadata": {},
  "payer": null,
  "paidBy": null,
  "txHash": null,
  "checkoutUrl": "http://localhost:3000/pay/pay_7Hq2…",
  "successUrl": null,
  "cancelUrl": null,
  "expiresAt": "2026-11-21T14:15:00.000Z",
  "paidAt": null,
  "createdAt": "2026-11-21T14:00:00.000Z",
  "livemode": false
}
```

Send the customer to `checkoutUrl`, or let `@aevify/react` open it in a modal.

### Retrieve a payment

`GET /api/v1/payments/:id` (secret key). The status is refreshed from the contract on every read.

| `status` | Meaning |
|---|---|
| `created` | Waiting for payment |
| `paid` | Paid on Aevum. `paidBy`, `paidAt`, `fee` and `txHash` are set. Partial refunds show in `refunded`. |
| `refunded` | Fully refunded by the merchant |
| `expired` | Not paid before `expiresAt`; can no longer be paid |

### List payments

`GET /api/v1/payments?limit=20&startingAfter=pay_…` (secret key). Newest first;
`hasMore` tells you whether to fetch the next page with `startingAfter` = the last ID.

---

## Checkout data (hosted checkout and AI agents)

`GET /api/v1/checkout/:id`: **public**, no key, CORS-enabled. Payment IDs are unguessable.

Returns everything needed to pay, and no merchant secrets:

```json
{
  "id": "pay_7Hq2…",
  "object": "checkout",
  "status": "created",
  "merchant": { "name": "Demo Store", "slug": "demo-store-x1y2z", "verified": true, "payoutAddress": "0x…" },
  "amount": "25.00",
  "amountBaseUnits": "25000000",
  "currency": "tUSD8",
  "expiresAt": "…",
  "chain": { "id": 44005, "name": "QDay Aevum Testnet" },
  "token": { "address": "0x4565…3483", "symbol": "tUSD8", "decimals": 6 },
  "contractCall": {
    "address": "0x<AevifyCheckout>",
    "functionName": "pay",
    "abi": [ … ],
    "approve": { "token": "0x4565…3483", "spender": "0x<AevifyCheckout>", "amount": "25000000" },
    "args": {
      "request": { "paymentId": "0x…", "merchantId": "0x…", "amount": "25000000", "expiresAt": "1795…", "payer": "0x000…000" },
      "signature": "0x…"
    }
  }
}
```

**To pay in code** (what an AI agent does):

1. `GET /api/v1/checkout/:id` and check it against your spending policy (amount, `merchant.verified`, `expiresAt`).
2. `approve(contractCall.approve.spender, contractCall.approve.amount)` on the token.
3. Call `pay(args.request, args.signature)` on `contractCall.address`, converting `amount` and `expiresAt` to integers.
4. The merchant's next read (or webhook, once the listener is live) shows the payment as `paid`.

---

## Hosted checkout

`checkoutUrl` (`/pay/:id`) is a ready-made checkout page. The customer:

1. sees your business name (with "Verified on Aevum" once your payout wallet is registered),
   the amount, description and a countdown to `expiresAt`;
2. connects a browser wallet (MetaMask or any EIP-6963 wallet; on mobile, "Open in MetaMask");
3. is switched to Aevum automatically (the network is added to the wallet if needed);
4. pays in **one step** if the token supports EIP-2612 permits (a free signature, then one
   transaction), otherwise **approve, then pay**;
5. sees a receipt with a link to the transaction, then returns to your `successUrl`.

Balances, gas, payer-locked payments, expiry and contract errors are all explained in plain
language before anything is sent.

**Return URLs:** after payment the customer is sent to `successUrl` with
`?aevify_payment_id=pay_…` appended. "Cancel and return" goes to `cancelUrl`. Always confirm the
payment server-side (`GET /api/v1/payments/:id` or the webhook) before fulfilling: a URL alone
isn't proof of payment.

**Embedded:** `/pay/:id?embed=1` is for showing the checkout in an iframe (what `@aevify/react`
will do). Instead of redirecting, it posts messages to the parent window:

```js
window.addEventListener("message", (e) => {
  if (e.data?.source !== "aevify") return;
  // e.data.type: "ready" | "payment.paid" (with txHash) | "payment.cancelled"
  // e.data.paymentId
});
```

## Public config

`GET /api/v1/config`: public, CORS-enabled. The chain (ID, name, RPC URL for wallets, explorer),
the checkout contract address and the token. Used by the dashboard and SDKs.

---

## Dashboard API (signed-in session)

Used by the dashboard; authenticated with the session cookie from signing in.

| Method | Path | Does |
|---|---|---|
| GET | `/api/merchant` | Current user and business (`merchant: null` until created) |
| POST | `/api/merchant` | `{ name }`: create the business, plus a publishable key |
| PATCH | `/api/merchant` | `{ name?, webhookUrl? }` (`https://`; `http://localhost` in development) |
| POST | `/api/merchant/payout-wallet/challenge` | `{ address }`: a message for the wallet to sign |
| POST | `/api/merchant/payout-wallet` | `{ address, signature }`: first wallet registers the merchant on-chain; later changes wait 24 hours |
| POST | `/api/merchant/payout-wallet/apply` | Apply a payout change after its 24-hour delay |
| GET/POST | `/api/merchant/keys` | List keys / create (`{ kind: "secret" \| "publishable" }`, max 5 active secret keys) |
| DELETE | `/api/merchant/keys/:id` | Revoke a key immediately |
| POST | `/api/merchant/webhook-secret` | Rotate the webhook signing secret |
| GET | `/api/merchant/payments?status=&limit=&startingAfter=` | Payments, optionally filtered by status |
| POST | `/api/merchant/payments` | Create a payment link (same fields as `POST /api/v1/payments`) |
| GET | `/api/merchant/payments/:id` | One payment, refreshed from the chain |
| GET | `/api/merchant/stats` | Volume, fees, refunds, net, counts by status, and a 14-day series |

## Health

`GET /api/health`: database connection, and whether the API's signer and operator keys
match the deployed contract's roles. Returns `hints` for anything misconfigured.
