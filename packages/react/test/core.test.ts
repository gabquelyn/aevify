import { describe, expect, it } from "vitest";
import { checkoutUrl, readAevifyMessage, validateConfig } from "../src/core.ts";

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
