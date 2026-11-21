# @aevify/react

A Pay button and checkout modal for [Aevify](https://github.com/): stablecoin checkout settled in
tUSD8 on QDay Aevum. About 10 KB, no wallet libraries: the wallet and payment logic live on
Aevify's hosted checkout, which this package opens.

> Testnet only (QDay Aevum Testnet). tUSD8 is a test token with no value.

```bash
npm install @aevify/react
```

```tsx
import { AevifyButton } from "@aevify/react";

<AevifyButton
  publishableKey="pk_test_..."
  baseUrl="https://your-aevify-app.example"
  createPayment={() => fetch("/api/checkout", { method: "POST" }).then((r) => r.json()).then((p) => p.id)}
  onSuccess={({ paymentId }) => console.log("paid", paymentId)}
/>
```

- Modal on desktop, redirect on phones (`mode` to choose)
- Your checkout only loads on the domains you allow in the Aevify dashboard (enforced by the browser)
- Only trusts messages from your Aevify origin and its own frame
- Falls back to opening the checkout in a new tab if it can't be embedded
- Works in the Next.js App Router (ships as a client component)

Create the payment on your server with [`@aevify/node`](https://www.npmjs.com/package/@aevify/node),
and fulfil orders from the `payment.paid` webhook, not from `onSuccess`.

Full documentation: the `/docs/sdk/react` page of your Aevify app.

MIT licensed.
