import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { merchantIdFromSlug, paymentIdToBytes32, paymentRequestTypedData } from "@aevify/shared";
import { hashTypedData, keccak256, parseUnits, recoverTypedDataAddress, toHex, zeroAddress, type Hex } from "viem";

const { viem, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

const usd = (value: string) => parseUnits(value, 6); // tUSD8 has 6 decimals
const id = (label: string): Hex => keccak256(toHex(label));
const DAY = 24 * 60 * 60;
const FEE_BPS = 300;

type PaymentRequest = {
  paymentId: Hex;
  merchantId: Hex;
  amount: bigint;
  expiresAt: bigint;
  payer: `0x${string}`;
};

async function deployFixture() {
  const [owner, signer, operator, feeRecipient, merchant, customer, agent, other, newPayout] =
    await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const token = await viem.deployContract("MockUSD8");
  const checkout = await viem.deployContract("AevifyCheckout", [
    token.address,
    owner.account.address,
    signer.account.address,
    operator.account.address,
    feeRecipient.account.address,
    FEE_BPS,
  ]);

  const merchantId = id("merchant:demo-store");
  await checkout.write.registerMerchant([merchantId, merchant.account.address], { account: operator.account });

  // Fund the customer, agent and merchant (merchant needs funds to refund).
  for (const wallet of [customer, agent, merchant]) {
    await token.write.mint([wallet.account.address, usd("1000")]);
  }

  const chainId = await publicClient.getChainId();

  /** Build a request, then sign it the way the Aevify backend will (EIP-712). */
  async function signedRequest(overrides: Partial<PaymentRequest> = {}, signingWallet = signer) {
    const req: PaymentRequest = {
      paymentId: id(`payment:${Math.random()}`),
      merchantId,
      amount: usd("25"),
      expiresAt: BigInt((await time.latest()) + 15 * 60),
      payer: zeroAddress,
      ...overrides,
    };
    const signature = await signingWallet.signTypedData({
      domain: { name: "Aevify Checkout", version: "1", chainId, verifyingContract: checkout.address },
      types: {
        PaymentRequest: [
          { name: "paymentId", type: "bytes32" },
          { name: "merchantId", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "expiresAt", type: "uint64" },
          { name: "payer", type: "address" },
        ],
      },
      primaryType: "PaymentRequest",
      message: req,
    });
    return { req, signature };
  }

  async function approve(wallet: typeof customer, amount: bigint) {
    await token.write.approve([checkout.address, amount], { account: wallet.account });
  }

  return {
    owner, signer, operator, feeRecipient, merchant, customer, agent, other, newPayout,
    publicClient, token, checkout, merchantId, chainId, signedRequest, approve,
  };
}

describe("AevifyCheckout", () => {
  describe("deployment", () => {
    it("stores its configuration", async () => {
      const { checkout, token, signer, operator, feeRecipient, owner } = await loadFixture(deployFixture);
      assert.equal((await checkout.read.token()).toLowerCase(), token.address.toLowerCase());
      assert.equal((await checkout.read.signer()).toLowerCase(), signer.account.address.toLowerCase());
      assert.equal((await checkout.read.operator()).toLowerCase(), operator.account.address.toLowerCase());
      assert.equal((await checkout.read.feeRecipient()).toLowerCase(), feeRecipient.account.address.toLowerCase());
      assert.equal((await checkout.read.owner()).toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(await checkout.read.feeBps(), FEE_BPS);
      assert.equal(await checkout.read.MAX_FEE_BPS(), 500);
    });

    it("refuses a fee above the 5% ceiling", async () => {
      const { token, owner, signer, operator, feeRecipient, checkout } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomErrorWithArgs(
        viem.deployContract("AevifyCheckout", [
          token.address, owner.account.address, signer.account.address,
          operator.account.address, feeRecipient.account.address, 501,
        ]),
        checkout,
        "FeeTooHigh",
        [501, 500],
      );
    });

    it("quotes the fee and merchant payout", async () => {
      const { checkout } = await loadFixture(deployFixture);
      const [fee, merchantReceives] = await checkout.read.quote([usd("25")]);
      assert.equal(fee, usd("0.75"));
      assert.equal(merchantReceives, usd("24.25"));
    });
  });

  describe("paying", () => {
    it("splits a payment between merchant (97%) and fee recipient (3%)", async () => {
      const { checkout, token, customer, merchant, feeRecipient, signedRequest, approve } =
        await loadFixture(deployFixture);
      const { req, signature } = await signedRequest();
      await approve(customer, req.amount);

      const merchantBefore = await token.read.balanceOf([merchant.account.address]);
      await viem.assertions.emitWithArgs(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "PaymentPaid",
        [req.paymentId, req.merchantId, customer.account.address, merchant.account.address, usd("25"), usd("0.75")],
      );

      assert.equal(await token.read.balanceOf([merchant.account.address]), merchantBefore + usd("24.25"));
      assert.equal(await token.read.balanceOf([feeRecipient.account.address]), usd("0.75"));
      assert.equal(await token.read.balanceOf([checkout.address]), 0n, "contract never holds funds");
      assert.equal(await checkout.read.isPaid([req.paymentId]), true);

      const payment = await checkout.read.getPayment([req.paymentId]);
      assert.equal(payment.payer.toLowerCase(), customer.account.address.toLowerCase());
      assert.equal(payment.amount, usd("25"));
      assert.equal(payment.fee, usd("0.75"));
    });

    it("rounds tiny fees down to zero instead of failing", async () => {
      const { checkout, token, customer, merchant, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ amount: 1n }); // 0.000001 tUSD8
      await approve(customer, 1n);
      const before = await token.read.balanceOf([merchant.account.address]);
      await checkout.write.pay([req, signature], { account: customer.account });
      assert.equal(await token.read.balanceOf([merchant.account.address]), before + 1n);
    });

    it("can't be paid twice (no replay)", async () => {
      const { checkout, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest();
      await approve(customer, req.amount * 2n);
      await checkout.write.pay([req, signature], { account: customer.account });
      await viem.assertions.revertWithCustomErrorWithArgs(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "AlreadyPaid",
        [req.paymentId],
      );
    });

    it("rejects an expired request", async () => {
      const { checkout, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest();
      await approve(customer, req.amount);
      await time.increase(16 * 60);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "RequestExpired",
      );
    });

    it("rejects a tampered amount", async () => {
      const { checkout, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ amount: usd("25") });
      await approve(customer, usd("25"));
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([{ ...req, amount: usd("0.01") }, signature], { account: customer.account }),
        checkout,
        "InvalidSignature",
      );
    });

    it("rejects a request signed by anyone other than the Aevify signer", async () => {
      const { checkout, customer, other, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({}, other);
      await approve(customer, req.amount);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "InvalidSignature",
      );
    });

    it("rejects an unknown merchant", async () => {
      const { checkout, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ merchantId: id("merchant:nobody") });
      await approve(customer, req.amount);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "UnknownMerchant",
      );
    });

    it("rejects a zero amount", async () => {
      const { checkout, customer, signedRequest } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ amount: 0n });
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "InvalidAmount",
      );
    });

    it("fails without enough allowance", async () => {
      const { checkout, token, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest();
      await approve(customer, req.amount - 1n);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        token,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("signing with @aevify/shared (what the Aevify API uses)", () => {
    it("produces the same EIP-712 digest as the contract", async () => {
      const { checkout, chainId } = await loadFixture(deployFixture);
      const request = {
        paymentId: paymentIdToBytes32("pay_test123"),
        merchantId: merchantIdFromSlug("demo-store"),
        amount: usd("12.34"),
        expiresAt: 1_900_000_000n,
        payer: zeroAddress,
      } as const;
      const typedData = paymentRequestTypedData({ chainId, checkoutAddress: checkout.address, request });
      assert.equal(hashTypedData(typedData), await checkout.read.hashPaymentRequest([request]));
    });

    it("signs requests the contract accepts", async () => {
      const { checkout, signer, customer, chainId, approve } = await loadFixture(deployFixture);
      const request = {
        paymentId: paymentIdToBytes32("pay_shared_helper"),
        merchantId: merchantIdFromSlug("merchant:demo-store"),
        amount: usd("3"),
        expiresAt: BigInt((await time.latest()) + 600),
        payer: zeroAddress,
      } as const;
      const typedData = paymentRequestTypedData({ chainId, checkoutAddress: checkout.address, request });
      const signature = await signer.signTypedData(typedData);
      assert.equal(
        (await recoverTypedDataAddress({ ...typedData, signature })).toLowerCase(),
        signer.account.address.toLowerCase(),
      );
      await approve(customer, request.amount);
      await checkout.write.pay([request, signature], { account: customer.account });
      assert.equal(await checkout.read.isPaid([request.paymentId]), true);
    });
  });

  describe("AI agents", () => {
    it("lets an agent pay a request restricted to its own address", async () => {
      const { checkout, agent, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ payer: agent.account.address, amount: usd("2") });
      await approve(agent, req.amount);
      await checkout.write.pay([req, signature], { account: agent.account });
      assert.equal(await checkout.read.isPaid([req.paymentId]), true);
    });

    it("stops anyone else paying a request restricted to an agent", async () => {
      const { checkout, agent, other, token, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest({ payer: agent.account.address });
      await token.write.mint([other.account.address, req.amount]);
      await approve(other, req.amount);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: other.account }),
        checkout,
        "PayerMismatch",
      );
    });
  });

  describe("paying with permit (one step)", () => {
    async function signPermit(
      fx: Awaited<ReturnType<typeof deployFixture>>,
      wallet: typeof fx.customer,
      value: bigint,
      deadline: bigint,
    ) {
      const nonce = await fx.token.read.nonces([wallet.account.address]);
      const signature = await wallet.signTypedData({
        domain: { name: "Mock tUSD8", version: "1", chainId: fx.chainId, verifyingContract: fx.token.address },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner: wallet.account.address, spender: fx.checkout.address, value, nonce, deadline },
      });
      const r = `0x${signature.slice(2, 66)}` as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const v = Number.parseInt(signature.slice(130, 132), 16);
      return { v, r, s };
    }

    it("pays without a separate approve transaction", async () => {
      const fx = await loadFixture(deployFixture);
      const { req, signature } = await fx.signedRequest();
      const deadline = BigInt((await time.latest()) + 600);
      const { v, r, s } = await signPermit(fx, fx.customer, req.amount, deadline);
      await fx.checkout.write.payWithPermit([req, signature, deadline, v, r, s], { account: fx.customer.account });
      assert.equal(await fx.checkout.read.isPaid([req.paymentId]), true);
    });

    it("still pays with an existing allowance if the permit fails", async () => {
      const fx = await loadFixture(deployFixture);
      const { req, signature } = await fx.signedRequest();
      await fx.approve(fx.customer, req.amount);
      const junk = `0x${"11".repeat(32)}` as Hex;
      await fx.checkout.write.payWithPermit([req, signature, 0n, 27, junk, junk], { account: fx.customer.account });
      assert.equal(await fx.checkout.read.isPaid([req.paymentId]), true);
    });
  });

  describe("refunds", () => {
    async function paidFixture() {
      const fx = await deployFixture();
      const { req, signature } = await fx.signedRequest({ amount: usd("40") });
      await fx.approve(fx.customer, req.amount);
      await fx.checkout.write.pay([req, signature], { account: fx.customer.account });
      return { ...fx, req };
    }

    it("lets the merchant refund in parts, back to the original payer", async () => {
      const { checkout, token, merchant, customer, req } = await loadFixture(paidFixture);
      await token.write.approve([checkout.address, usd("40")], { account: merchant.account });
      const before = await token.read.balanceOf([customer.account.address]);

      await viem.assertions.emitWithArgs(
        checkout.write.refund([req.paymentId, usd("10")], { account: merchant.account }),
        checkout,
        "PaymentRefunded",
        [req.paymentId, req.merchantId, customer.account.address, usd("10"), usd("10")],
      );
      await checkout.write.refund([req.paymentId, usd("30")], { account: merchant.account });

      assert.equal(await token.read.balanceOf([customer.account.address]), before + usd("40"));
      assert.equal((await checkout.read.getPayment([req.paymentId])).refunded, usd("40"));
    });

    it("never refunds more than was paid", async () => {
      const { checkout, token, merchant, req } = await loadFixture(paidFixture);
      await token.write.approve([checkout.address, usd("100")], { account: merchant.account });
      await viem.assertions.revertWithCustomError(
        checkout.write.refund([req.paymentId, usd("40.000001")], { account: merchant.account }),
        checkout,
        "InvalidAmount",
      );
    });

    it("only lets the merchant's payout wallet refund", async () => {
      const { checkout, other, req } = await loadFixture(paidFixture);
      await viem.assertions.revertWithCustomError(
        checkout.write.refund([req.paymentId, usd("1")], { account: other.account }),
        checkout,
        "Unauthorized",
      );
    });

    it("still allows refunds while payments are paused", async () => {
      const { checkout, token, operator, merchant, req } = await loadFixture(paidFixture);
      await checkout.write.pause({ account: operator.account });
      await token.write.approve([checkout.address, usd("5")], { account: merchant.account });
      await checkout.write.refund([req.paymentId, usd("5")], { account: merchant.account });
      assert.equal((await checkout.read.getPayment([req.paymentId])).refunded, usd("5"));
    });
  });

  describe("emergency pause", () => {
    it("stops payments when the operator pauses, and only the owner can unpause", async () => {
      const { checkout, operator, owner, customer, signedRequest, approve } = await loadFixture(deployFixture);
      await checkout.write.pause({ account: operator.account });

      const { req, signature } = await signedRequest();
      await approve(customer, req.amount);
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "EnforcedPause",
      );

      await viem.assertions.revertWithCustomError(
        checkout.write.unpause({ account: operator.account }),
        checkout,
        "OwnableUnauthorizedAccount",
      );
      await checkout.write.unpause({ account: owner.account });
      await checkout.write.pay([req, signature], { account: customer.account });
    });

    it("doesn't let strangers pause", async () => {
      const { checkout, other } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(
        checkout.write.pause({ account: other.account }),
        checkout,
        "Unauthorized",
      );
    });
  });

  describe("merchants and payout wallet changes", () => {
    it("only lets the operator or owner register merchants, once per ID", async () => {
      const { checkout, other, operator, merchantId } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(
        checkout.write.registerMerchant([id("merchant:x"), other.account.address], { account: other.account }),
        checkout,
        "Unauthorized",
      );
      await viem.assertions.revertWithCustomError(
        checkout.write.registerMerchant([merchantId, other.account.address], { account: operator.account }),
        checkout,
        "MerchantExists",
      );
    });

    it("applies a payout change only after 24 hours", async () => {
      const { checkout, merchant, newPayout, merchantId, customer, token, signedRequest, approve } =
        await loadFixture(deployFixture);
      await checkout.write.requestPayoutChange([merchantId, newPayout.account.address], {
        account: merchant.account,
      });

      await viem.assertions.revertWithCustomError(
        checkout.write.applyPayoutChange([merchantId]),
        checkout,
        "PayoutChangeNotReady",
      );

      // Payments still go to the old wallet during the delay.
      const first = await signedRequest();
      await approve(customer, first.req.amount);
      await checkout.write.pay([first.req, first.signature], { account: customer.account });
      assert.equal(await token.read.balanceOf([newPayout.account.address]), 0n);

      await time.increase(DAY);
      await checkout.write.applyPayoutChange([merchantId]);
      const merchantInfo = await checkout.read.getMerchant([merchantId]);
      assert.equal(merchantInfo.payout.toLowerCase(), newPayout.account.address.toLowerCase());

      const second = await signedRequest();
      await approve(customer, second.req.amount);
      await checkout.write.pay([second.req, second.signature], { account: customer.account });
      assert.equal(await token.read.balanceOf([newPayout.account.address]), usd("24.25"));
    });

    it("lets the current payout wallet cancel a change (e.g. from a hijacked account)", async () => {
      const { checkout, operator, merchant, other, merchantId } = await loadFixture(deployFixture);
      await checkout.write.requestPayoutChange([merchantId, other.account.address], { account: operator.account });
      await checkout.write.cancelPayoutChange([merchantId], { account: merchant.account });
      await time.increase(DAY);
      await viem.assertions.revertWithCustomError(
        checkout.write.applyPayoutChange([merchantId]),
        checkout,
        "NoPendingPayoutChange",
      );
    });

    it("doesn't let strangers request or cancel changes", async () => {
      const { checkout, operator, other, merchantId } = await loadFixture(deployFixture);
      await viem.assertions.revertWithCustomError(
        checkout.write.requestPayoutChange([merchantId, other.account.address], { account: other.account }),
        checkout,
        "Unauthorized",
      );
      await checkout.write.requestPayoutChange([merchantId, other.account.address], { account: operator.account });
      await viem.assertions.revertWithCustomError(
        checkout.write.cancelPayoutChange([merchantId], { account: operator.account }),
        checkout,
        "Unauthorized",
      );
    });
  });

  describe("admin", () => {
    it("lets the owner lower the fee but never exceed 5%", async () => {
      const { checkout, owner } = await loadFixture(deployFixture);
      await checkout.write.setFeeBps([100], { account: owner.account });
      assert.equal(await checkout.read.feeBps(), 100);
      await viem.assertions.revertWithCustomError(
        checkout.write.setFeeBps([501], { account: owner.account }),
        checkout,
        "FeeTooHigh",
      );
    });

    it("keeps admin functions owner-only", async () => {
      const { checkout, other } = await loadFixture(deployFixture);
      for (const call of [
        checkout.write.setFeeBps([0], { account: other.account }),
        checkout.write.setSigner([other.account.address], { account: other.account }),
        checkout.write.setOperator([other.account.address], { account: other.account }),
        checkout.write.setFeeRecipient([other.account.address], { account: other.account }),
      ]) {
        await viem.assertions.revertWithCustomError(call, checkout, "OwnableUnauthorizedAccount");
      }
    });

    it("can't renounce ownership", async () => {
      const { checkout } = await loadFixture(deployFixture);
      // renounceOwnership is overridden as `pure` (it always reverts), so viem exposes it under `read`.
      await viem.assertions.revertWithCustomError(
        checkout.read.renounceOwnership(),
        checkout,
        "RenounceDisabled",
      );
    });

    it("transfers ownership in two steps", async () => {
      const { checkout, owner, other } = await loadFixture(deployFixture);
      await checkout.write.transferOwnership([other.account.address], { account: owner.account });
      assert.equal((await checkout.read.owner()).toLowerCase(), owner.account.address.toLowerCase());
      await checkout.write.acceptOwnership({ account: other.account });
      assert.equal((await checkout.read.owner()).toLowerCase(), other.account.address.toLowerCase());
    });

    it("invalidates old signatures when the signer key is rotated", async () => {
      const { checkout, owner, other, customer, signedRequest, approve } = await loadFixture(deployFixture);
      const { req, signature } = await signedRequest();
      await approve(customer, req.amount);
      await checkout.write.setSigner([other.account.address], { account: owner.account });
      await viem.assertions.revertWithCustomError(
        checkout.write.pay([req, signature], { account: customer.account }),
        checkout,
        "InvalidSignature",
      );
    });
  });
});
