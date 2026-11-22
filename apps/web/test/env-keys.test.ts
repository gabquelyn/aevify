import { afterEach, describe, expect, it } from "vitest";
import { env } from "../src/lib/env";

const KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("private keys from the environment", () => {
  afterEach(() => {
    delete process.env.AEVIFY_SIGNER_PRIVATE_KEY;
  });
  it("accepts keys with or without 0x", () => {
    process.env.AEVIFY_SIGNER_PRIVATE_KEY = KEY;
    expect(env.signerPrivateKey()).toBe(`0x${KEY}`);
    process.env.AEVIFY_SIGNER_PRIVATE_KEY = `0x${KEY}`;
    expect(env.signerPrivateKey()).toBe(`0x${KEY}`);
    process.env.AEVIFY_SIGNER_PRIVATE_KEY = ` "0x${KEY}" `;
    expect(env.signerPrivateKey()).toBe(`0x${KEY}`);
  });
  it("rejects anything else", () => {
    process.env.AEVIFY_SIGNER_PRIVATE_KEY = KEY.slice(2);
    expect(() => env.signerPrivateKey()).toThrow(/64 hex characters/);
  });
  it("is undefined when unset", () => {
    expect(env.signerPrivateKey()).toBeUndefined();
  });
});
