# @aevify/node

Server SDK for [Aevify](https://github.com/): stablecoin checkout for online stores and AI agents,
settled in tUSD8 on QDay Aevum. Create payments and verify webhooks. No dependencies.

> Testnet only (QDay Aevum Testnet). tUSD8 is a test token with no value.

```bash
npm install @aevify/node
```

```ts
import { Aevify } from "@aevify/node";

const aevify = new Aevify(process.env.AEVIFY_SECRET_KEY!, { baseUrl: process.env.AEVIFY_BASE_URL });

// Create a payment, then send the customer to payment.checkoutUrl (or use @aevify/react)
const payment = await aevify.payments.create({ amount: "25.00", orderId: "1042" }, { idempotencyKey: "order-1042" });

// In your webhook handler (use the raw body)
const event = await aevify.webhooks.constructEvent(rawBody, request.headers.get("aevify-signature"), process.env.AEVIFY_WEBHOOK_SECRET!);
if (event.type === "payment.paid") {
  // fulfil event.data.object.orderId
}
```

- Payments: `create`, `retrieve`, `list`, `listAll`, `retrieveCheckout`
- Safe retries: an idempotency key is always sent; network errors, 429 and 5xx are retried
- Typed errors: `InvalidRequestError`, `AuthenticationError`, `MerchantNotReadyError`, …
- Webhook verification with Web Crypto (Node 20+, Bun, Deno, edge)
- Refuses to run in a browser

Full documentation: the `/docs/sdk/node` page of your Aevify app.

MIT licensed.
