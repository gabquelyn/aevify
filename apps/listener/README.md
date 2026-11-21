# apps/listener

Long-running worker that watches the Aevify checkout contract on Aevum Testnet,
updates payment status, and delivers signed webhooks to merchants.

Runs as its own process (not inside Next.js), because it must stay up continuously.

_Not built yet._
