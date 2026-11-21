/** Framework-free helpers: URLs, message validation and device detection. */

export type AevifyConfig = {
  /** Your publishable key (pk_test_...). Safe in the browser. */
  publishableKey: string;
  /** Your Aevify app's URL, e.g. "https://aevify.vercel.app". */
  baseUrl: string;
};

export type CheckoutResult = { paymentId: string; txHash?: string };

export type AevifyMessage =
  | { source: "aevify"; type: "ready"; paymentId: string }
  | { source: "aevify"; type: "resize"; paymentId: string; height: number }
  | { source: "aevify"; type: "payment.paid"; paymentId: string; txHash?: string }
  | { source: "aevify"; type: "payment.cancelled"; paymentId: string }
  | { source: "aevify"; type: "error"; reason: string };

const trim = (url: string) => url.replace(/\/+$/, "");

export function checkoutUrl(config: AevifyConfig, paymentId: string, options: { embed?: boolean; origin?: string } = {}): string {
  const url = new URL(`${trim(config.baseUrl)}/pay/${encodeURIComponent(paymentId)}`);
  if (options.embed) {
    url.searchParams.set("embed", "1");
    url.searchParams.set("pk", config.publishableKey);
    if (options.origin) url.searchParams.set("origin", options.origin);
  }
  return url.toString();
}

export function validateConfig(config: AevifyConfig): string | null {
  if (!config.publishableKey?.startsWith("pk_")) {
    return config.publishableKey?.startsWith("sk_")
      ? "Never put a secret key in the browser. Pass your publishable key (pk_test_...) to @aevify/react."
      : "Pass your publishable key (pk_test_...) to @aevify/react.";
  }
  try {
    new URL(config.baseUrl);
  } catch {
    return "Pass baseUrl: your Aevify app's URL, e.g. https://aevify.vercel.app.";
  }
  return null;
}

/**
 * Only trust messages from the Aevify origin, from the checkout frame we opened, about the
 * payment we opened. Anything else is ignored.
 */
export function readAevifyMessage(
  event: Pick<MessageEvent, "origin" | "data" | "source">,
  baseUrl: string,
  paymentId: string,
  frame?: unknown,
): AevifyMessage | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(baseUrl).origin;
  } catch {
    return null;
  }
  if (event.origin !== expectedOrigin) return null;
  if (frame && event.source !== frame) return null;
  const data = event.data as Partial<AevifyMessage> | null;
  if (!data || typeof data !== "object" || data.source !== "aevify" || typeof data.type !== "string") return null;
  if (data.type !== "error" && (data as { paymentId?: string }).paymentId !== paymentId) return null;
  return data as AevifyMessage;
}

/** Phones and narrow screens get a full-page redirect instead of a modal (wallet apps prefer it). */
export function prefersRedirect(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent) || window.innerWidth < 640;
}
