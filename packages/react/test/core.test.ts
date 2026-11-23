import { describe, expect, it } from "vitest";
import { checkEmbed, checkoutUrl, embedCheckUrl, readAevifyMessage, validateConfig } from "../src/core.ts";

const config = { publishableKey: `pk_test_${"a".repeat(32)}`, baseUrl: "https://pay.aevify.test/" };

describe("checkoutUrl", () => {
  it("builds hosted and embedded URLs", () => {
    expect(checkoutUrl(config, "pay_123")).toBe("https://pay.aevify.test/pay/pay_123");
    expect(checkoutUrl(config, "pay_123", { embed: true, origin: "https://shop.example" })).toBe(
      `https://pay.aevify.test/pay/pay_123?embed=1&pk=${config.publishableKey}&origin=https%3A%2F%2Fshop.example`,
    );
  });
});

describe("validateConfig", () => {
  it("catches secret keys and bad URLs", () => {
    expect(validateConfig(config)).toBeNull();
    expect(validateConfig({ ...config, publishableKey: "sk_test_x" })).toMatch(/Never put a secret key/);
    expect(validateConfig({ ...config, baseUrl: "not a url" })).toMatch(/baseUrl/);
  });
});

describe("readAevifyMessage", () => {
  const frame = {};
  const msg = (over: Partial<MessageEvent> & { data?: unknown }) =>
    readAevifyMessage({ origin: "https://pay.aevify.test", source: frame as never, data: { source: "aevify", type: "ready", paymentId: "pay_1" }, ...over }, config.baseUrl, "pay_1", frame);

  it("accepts messages from the Aevify origin and our frame", () => {
    expect(msg({})).toMatchObject({ type: "ready" });
  });

  it("ignores other origins, other frames, other payments and junk", () => {
    expect(msg({ origin: "https://evil.example" })).toBeNull();
    expect(msg({ source: {} as never })).toBeNull();
    expect(msg({ data: { source: "aevify", type: "payment.paid", paymentId: "pay_2" } })).toBeNull();
    expect(msg({ data: "hello" })).toBeNull();
    expect(msg({ data: { type: "ready", paymentId: "pay_1" } })).toBeNull();
  });
});

describe("checkEmbed", () => {
  const config = { publishableKey: "pk_test_abc", baseUrl: "https://aevify.example/" };
  it("builds the check URL", () => {
    expect(embedCheckUrl(config, "pay_1", "https://shop.example")).toBe(
      "https://aevify.example/api/v1/checkout/pay_1/embed?pk=pk_test_abc&origin=https%3A%2F%2Fshop.example",
    );
    expect(embedCheckUrl({ ...config, baseUrl: "https://aevify.example/api/v1" }, "pay_1", "https://s.example")).toContain("https://aevify.example/api/v1/checkout/");
  });
  it("returns Aevify's reason when embedding isn't allowed", async () => {
    const fetchImpl = (async () => Response.json({ ok: false, reason: "origin_not_allowed", message: "https://shop.example isn't in Admit's allowed domains." })) as typeof fetch;
    expect(await checkEmbed(config, "pay_1", "https://shop.example", fetchImpl)).toBe("https://shop.example isn't in Admit's allowed domains.");
  });
  it("lets the frame try when allowed or when the check is unavailable", async () => {
    expect(await checkEmbed(config, "pay_1", "https://shop.example", (async () => Response.json({ ok: true })) as typeof fetch)).toBeNull();
    expect(await checkEmbed(config, "pay_1", "https://shop.example", (async () => new Response("", { status: 404 })) as typeof fetch)).toBeNull();
    expect(await checkEmbed(config, "pay_1", "https://shop.example", (async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
  });
});
