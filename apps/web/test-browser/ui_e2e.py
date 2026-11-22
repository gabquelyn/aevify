"""Browser end-to-end test of the Aevify dashboard + hosted checkout against a local chain.

A scripted EIP-1193 wallet is injected into the page; it forwards JSON-RPC to the Hardhat
node, whose default accounts are unlocked, so signing and sending transactions work for real.
"""
import json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect
expect.set_options(timeout=30000)

APP = os.environ.get("APP_URL", "http://localhost:3600")
RPC = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
import os
OUT = os.environ.get("SCREENSHOTS_DIR", "screenshots")
os.makedirs(OUT, exist_ok=True)
ACCOUNTS = {
    "payout": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",   # merchant payout wallet (#1)
    "customer": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", # funded customer (#4)
    "customer2": "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",# funded customer (#5)
    "broke": "0x976EA74026E726554dB657fA54763abd0C3a0aa9",    # no tUSD8 (#6)
}

WALLET_JS = """
(() => {
  const cfg = %s;
  const provider = {
    isMetaMask: true,
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [cfg.account];
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_signTypedData_v4' && cfg.rejectTypedData) {
        const e = new Error('User rejected the request.'); e.code = 4001; throw e;
      }
      const res = await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
      const j = await res.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    },
    on() {}, removeListener() {},
  };
  window.ethereum = provider;
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    info: { uuid: 'test-wallet', name: 'Test Wallet', rdns: 'dev.aevify.testwallet',
      icon: "data:image/svg+xml,%%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%%3E%%3Crect width='20' height='20' rx='5' fill='%%230ea5e9'/%%3E%%3C/svg%%3E" },
    provider } }));
  window.addEventListener('eip6963:requestProvider', announce);
})();
"""

def api(path, method="GET", body=None, key=None):
    req = urllib.request.Request(APP + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **({"authorization": f"Bearer {key}"} if key else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name, flush=True)

def wallet_context(browser, account, reject_typed=False, **kw):
    ctx = browser.new_context(**kw)
    ctx.add_init_script(WALLET_JS % json.dumps({"account": account, "rpc": RPC, "rejectTypedData": reject_typed}))
    return ctx

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------------- Merchant: onboarding, wallet, keys, payment link ----------------
    m = wallet_context(browser, ACCOUNTS["payout"], viewport={"width": 1360, "height": 900})
    # A second extension that never answers: the dashboard must ask which wallet to use.
    m.add_init_script("""(() => {
      const decoy = { request: () => new Promise(() => {}), on() {}, removeListener() {} };
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
        info: { uuid: 'decoy', name: 'Decoy Wallet', rdns: 'dev.aevify.decoy', icon: '' }, provider: decoy } }));
      window.addEventListener('eip6963:requestProvider', announce);
    })();""")
    MERCHANT_EMAIL = f"merchant{int(time.time())}%40example.com"  # fresh merchant each run
    m.add_cookies([{"name": "aevify_test_user", "value": MERCHANT_EMAIL, "url": APP}])
    page = m.new_page()
    page.set_default_timeout(60000)
    page.goto(APP + "/dashboard")
    page.get_by_placeholder("Demo Store").fill("Lagos Coffee Co.")
    page.screenshot(path=f"{OUT}/01-onboarding.png")
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="Overview")).to_be_visible()
    check("onboarding creates the business", page.get_by_text("Connect a payout wallet to start accepting payments.").is_visible())

    page.get_by_role("link", name="Settings").first.click()
    page.get_by_role("button", name="Connect wallet").click()
    expect(page.get_by_test_id("wallet-picker")).to_be_visible()
    check("dashboard asks which wallet when several are installed", page.get_by_role("button", name="Decoy Wallet").is_visible())
    page.get_by_role("button", name="Test Wallet").click()
    expect(page.get_by_text("Verified on Aevum")).to_be_visible()
    check("payout wallet verified on-chain", page.get_by_text(ACCOUNTS["payout"]).is_visible())
    page.screenshot(path=f"{OUT}/02-settings-wallet.png")

    page.get_by_role("link", name="Developers").first.click()
    page.get_by_role("button", name="Create secret key").click()
    secret = page.get_by_test_id("new-secret-key").inner_text().strip()
    check("secret key shown once", secret.startswith("sk_test_"))
    page.screenshot(path=f"{OUT}/03-developers.png")

    page.get_by_role("link", name="Payments").first.click()
    page.get_by_role("button", name="New payment link").click()
    page.get_by_placeholder("25.00").fill("12.50")
    page.get_by_placeholder("Coffee beans, 1kg").fill("Single-origin beans, 1kg")
    page.get_by_role("button", name="Create link").click()
    expect(page.get_by_text("Payment link ready")).to_be_visible()
    link = page.locator("code").filter(has_text="/pay/").inner_text().strip()
    check("payment link created", "/pay/pay_" in link)
    page.screenshot(path=f"{OUT}/04-payment-link.png")
    page.get_by_role("button", name="Done").click()

    # ---------------- Customer 1: one-step checkout (permit) ----------------
    c = wallet_context(browser, ACCOUNTS["customer"], viewport={"width": 1280, "height": 860})
    cp = c.new_page(); cp.set_default_timeout(60000)
    cp.goto(link)
    expect(cp.get_by_text("Lagos Coffee Co.")).to_be_visible()
    check("checkout shows verified merchant", cp.get_by_text("Verified on Aevum").is_visible())
    cp.screenshot(path=f"{OUT}/05-checkout.png")
    cp.get_by_role("button", name=re.compile("Connect wallet to pay|Pay with Test Wallet")).click()
    expect(cp.get_by_role("button", name="Pay 12.50 tUSD8")).to_be_visible()
    cp.screenshot(path=f"{OUT}/06-checkout-connected.png")
    cp.get_by_role("button", name="Pay 12.50 tUSD8").click()
    expect(cp.get_by_text("Payment complete")).to_be_visible(timeout=60000)
    cp.screenshot(path=f"{OUT}/07-checkout-success.png")
    pid = link.rsplit("/", 1)[1]
    status = api(f"/api/v1/payments/{pid}", key=secret)
    check("one-step (permit) payment recorded as paid", status["status"] == "paid" and status["paidBy"] == ACCOUNTS["customer"])
    check("fee is 3% (0.375)", status["fee"] == "0.375")
    cp.reload()
    check("revisiting a paid link shows the receipt", cp.get_by_text("Payment complete").is_visible())

    # ---------------- Customer 2: approve + pay fallback, success redirect ----------------
    p2 = api("/api/v1/payments", "POST", {"amount": "3.00", "orderId": "A-77", "successUrl": APP + "/?thanks=1"}, key=secret)
    c2 = wallet_context(browser, ACCOUNTS["customer2"], reject_typed=False)
    # Force the two-step path by making the permit signature fail with a non-cancel error.
    c2.add_init_script("""(() => { const orig = window.ethereum.request.bind(window.ethereum);
      window.ethereum.request = async (a) => { if (a.method === 'eth_signTypedData_v4') { throw new Error('signTypedData not supported'); } return orig(a); }; })();""")
    q = c2.new_page(); q.set_default_timeout(60000)
    q.goto(p2["checkoutUrl"])
    q.get_by_role("button", name=re.compile("Connect wallet to pay|Pay with Test Wallet")).click()
    q.get_by_role("button", name="Pay 3.00 tUSD8").click()
    expect(q.get_by_text("Payment complete")).to_be_visible(timeout=60000)
    q.wait_for_url(re.compile(r"thanks=1"), timeout=15000)
    check("approve-then-pay path works and redirects to successUrl", "aevify_payment_id=" + p2["id"] in q.url)
    check("approve path recorded as paid", api(f"/api/v1/payments/{p2['id']}", key=secret)["status"] == "paid")

    # ---------------- Agent-locked payment opened by the wrong wallet ----------------
    p3 = api("/api/v1/payments", "POST", {"amount": "1.00", "payer": ACCOUNTS["customer2"]}, key=secret)
    w = c.new_page(); w.set_default_timeout(60000)
    w.goto(p3["checkoutUrl"])
    w.get_by_role("button", name=re.compile("Connect wallet to pay|Pay with Test Wallet")).click()
    expect(w.get_by_text("This payment can only be paid by")).to_be_visible()
    check("payer-locked payment blocks other wallets", w.get_by_role("button", name="Wrong wallet").is_disabled())

    # ---------------- Wallet with no tUSD8 ----------------
    p4 = api("/api/v1/payments", "POST", {"amount": "5.00"}, key=secret)
    b = wallet_context(browser, ACCOUNTS["broke"], viewport={"width": 390, "height": 844}, is_mobile=True)
    bp = b.new_page(); bp.set_default_timeout(60000)
    bp.goto(p4["checkoutUrl"])
    bp.screenshot(path=f"{OUT}/08-checkout-mobile.png")
    bp.get_by_role("button", name=re.compile("Connect wallet to pay|Pay with Test Wallet")).click()
    expect(bp.get_by_text("You need 5.00 tUSD8.")).to_be_visible()
    check("insufficient balance is explained", bp.get_by_role("button", name="Not enough tUSD8").is_disabled())
    bp.screenshot(path=f"{OUT}/09-checkout-insufficient-mobile.png")

    # ---------------- @aevify/react: the embedded checkout modal ----------------
    keys = page.evaluate("fetch('/api/merchant/keys').then(r => r.json())")
    pk = next(k["key"] for k in keys["data"] if k["kind"] == "publishable")
    p5 = api("/api/v1/payments", "POST", {"amount": "2.00", "description": "Embedded checkout"}, key=secret)
    e = c.new_page(); e.set_default_timeout(60000)
    e.goto(f"{APP}/dev/embed?pid={p5['id']}&pk={pk}")
    e.get_by_role("button", name="Pay with Aevify").click()
    frame = e.frame_locator("iframe[title='Aevify checkout']")
    frame.get_by_role("button", name=re.compile("Connect wallet to pay|Pay with Test Wallet")).click()
    expect(frame.get_by_role("button", name="Pay 2.00 tUSD8")).to_be_visible()
    e.screenshot(path=f"{OUT}/14-react-modal.png")
    frame.get_by_role("button", name="Pay 2.00 tUSD8").click()
    expect(frame.get_by_text("Payment complete")).to_be_visible(timeout=60000)
    e.screenshot(path=f"{OUT}/15-react-modal-paid.png")
    expect(e.get_by_test_id("result")).to_have_text(f"paid {p5['id']}")
    check("@aevify/react modal: onSuccess fires after paying inside the frame", api(f"/api/v1/payments/{p5['id']}", key=secret)["status"] == "paid")
    expect(e.locator("[data-aevify-checkout]")).to_have_count(0, timeout=10000)
    check("modal closes itself after success", True)

    e.goto(f"{APP}/dev/embed?pid={p4['id']}&pk=pk_test_{'x' * 32}")
    e.get_by_role("button", name="Pay with Aevify").click()
    expect(e.get_by_text("Couldn't open the checkout here")).to_be_visible()
    check("a publishable key from another store is refused", "error" in e.get_by_test_id("result").inner_text())

    def csp(path):
        with urllib.request.urlopen(APP + path) as r:
            return r.headers.get("content-security-policy")
    check("checkout can't be framed when not embedded", csp(f"/pay/{p4['id']}") == "frame-ancestors 'none'")
    check("embedded checkout limited to allowed domains", csp(f"/pay/{p4['id']}?embed=1").startswith("frame-ancestors 'self'"))

    # ---------------- Merchant: payments list, detail, refund, overview ----------------
    page.goto(APP + "/dashboard/payments")
    expect(page.get_by_text("Single-origin beans, 1kg")).to_be_visible()
    page.screenshot(path=f"{OUT}/10-payments.png")
    page.get_by_role("link", name=re.compile("12.50")).first.click()
    expect(page.get_by_role("heading", name="Refund")).to_be_visible()
    page.screenshot(path=f"{OUT}/11-payment-detail.png")
    page.get_by_role("button", name="Refund with payout wallet").click()
    expect(page.get_by_text(re.compile("Refund of 12.50 tUSD8 sent"))).to_be_visible(timeout=60000)
    expect(page.get_by_text("Fully refunded")).to_be_visible()
    check("refund from payout wallet marks the payment refunded", api(f"/api/v1/payments/{pid}", key=secret)["status"] == "refunded")
    page.screenshot(path=f"{OUT}/12-refunded.png")

    page.goto(APP + "/dashboard")
    expect(page.get_by_text("Successful payments")).to_be_visible()
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/13-overview.png")
    stats = page.evaluate("fetch('/api/merchant/stats').then(r => r.json())")
    check("overview stats add up", stats["volume"] == "17.50" and stats["refunded"] == "12.50" and stats["counts"]["refunded"] == 1)

    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
