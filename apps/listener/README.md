# apps/listener

The Aevify listener: a small always-on worker that

1. **scans the checkout contract** on Aevum for `PaymentPaid` and `PaymentRefunded` events and
   updates payments in MongoDB (it saves its block position, so restarts pick up where it left off);
2. **expires** unpaid payments past their deadline (after checking the chain);
3. **delivers webhooks**: signed with each merchant's secret (`Aevify-Signature`), retried with
   backoff for about 22 hours, with SSRF protection on merchant URLs.

Every event has a deterministic key, so an event is delivered once even if the listener restarts,
runs twice, or the web app noticed the change first.

```bash
docker compose up listener          # development (hot reload)
docker compose run --rm -w /app/apps/listener contracts npm test
```

Configuration comes from `.env` (see `.env.example`): `MONGODB_URI`, `AEVUM_RPC_URL`,
`AEVUM_CHAIN_ID`, `AEVIFY_CHECKOUT_ADDRESS`, `NEXT_PUBLIC_APP_URL`, plus optional `LISTENER_*`
tuning. `GET /health` on `PORT` (default 8080) reports its status.

Production: `apps/listener/Dockerfile` builds a single-file bundle in a tiny image. Deploy it on
Railway; see DEPLOY.md.
