import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { signWebhookPayload, WEBHOOK_EVENT_ID_HEADER, WEBHOOK_SIGNATURE_HEADER } from "@aevify/shared/webhooks";

export type SendResult = { ok: boolean; statusCode: number | null; error: string | null; durationMs: number };

/** Is this IP address private, loopback, link-local or otherwise not on the public internet? */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/**
 * Refuse webhook URLs that point into private networks (SSRF protection): a merchant could
 * otherwise make the listener call internal services on its host.
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("Webhook URL points to a private host.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Webhook URL resolves to a private network address.");
  }
}

/** POST a signed event. Never follows redirects; reads at most a small part of the response. */
export async function sendWebhook(params: {
  url: string;
  payload: string;
  secret: string;
  eventId: string;
  eventType: string;
  timeoutMs: number;
  allowPrivateUrls: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const started = Date.now();
  const done = (r: Omit<SendResult, "durationMs">): SendResult => ({ ...r, durationMs: Date.now() - started });
  try {
    const url = new URL(params.url);
    if (!params.allowPrivateUrls) await assertPublicUrl(url);
    const signature = await signWebhookPayload(params.payload, params.secret);
    const res = await (params.fetchImpl ?? fetch)(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(params.timeoutMs),
      headers: {
        "content-type": "application/json",
        "user-agent": "Aevify-Webhooks/1.0 (+https://github.com/aevify)",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_EVENT_ID_HEADER]: params.eventId,
        "Aevify-Event-Type": params.eventType,
      },
      body: params.payload,
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return done({ ok: true, statusCode: res.status, error: null });
    const hint = res.status >= 300 && res.status < 400 ? " (redirects aren't followed; use the final URL)" : "";
    return done({ ok: false, statusCode: res.status, error: `Endpoint responded ${res.status}${hint}` });
  } catch (error) {
    const message =
      (error as Error)?.name === "TimeoutError" ? `No response within ${params.timeoutMs / 1000}s` : ((error as Error)?.message ?? String(error));
    return done({ ok: false, statusCode: null, error: message.slice(0, 300) });
  }
}
