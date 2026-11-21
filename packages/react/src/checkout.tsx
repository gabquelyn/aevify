import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { checkoutUrl, readAevifyMessage, validateConfig, type AevifyConfig, type CheckoutResult } from "./core.ts";

export type AevifyCheckoutProps = AevifyConfig & {
  /** The payment to show (create it on your server with @aevify/node). */
  paymentId: string | null;
  open: boolean;
  /** Called whenever the modal closes (after success, cancel, Escape or the close button). */
  onClose: () => void;
  /** The customer paid. Confirm on your server (webhook or payments.retrieve) before fulfilling. */
  onSuccess?: (result: CheckoutResult) => void;
  onCancel?: (result: { paymentId: string }) => void;
  onError?: (error: Error) => void;
  /** Close automatically shortly after a successful payment. Default true. */
  closeOnSuccess?: boolean;
};

const READY_TIMEOUT_MS = 12_000;

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 2147483000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    background: "rgba(15, 23, 42, 0.35)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
  },
  panel: {
    position: "relative",
    width: "100%",
    maxWidth: 452,
    maxHeight: "calc(100dvh - 32px)",
    overflow: "auto",
    borderRadius: 28,
    background: "#ffffff",
    boxShadow: "0 24px 64px -16px rgba(15, 23, 42, 0.35)",
  },
  close: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 1,
    width: 32,
    height: 32,
    border: "none",
    borderRadius: 999,
    background: "rgba(255,255,255,0.9)",
    color: "#64748b",
    fontSize: 16,
    lineHeight: "32px",
    cursor: "pointer",
  },
  frame: { display: "block", width: "100%", border: 0, background: "transparent", transition: "height 150ms ease" },
  status: {
    padding: "56px 28px",
    textAlign: "center",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSize: 14,
    color: "#64748b",
  },
  link: { color: "#0284c7", fontWeight: 500 },
};

/** The hosted checkout in a modal, embedded from your Aevify app. */
export function AevifyCheckout(props: AevifyCheckoutProps) {
  const { paymentId, open, onClose, onSuccess, onCancel, onError, closeOnSuccess = true } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(560);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const paid = useRef(false);
  const callbacks = useRef({ onClose, onSuccess, onCancel, onError });
  callbacks.current = { onClose, onSuccess, onCancel, onError };

  const configError = validateConfig(props);
  const src = paymentId && !configError && typeof window !== "undefined"
    ? checkoutUrl(props, paymentId, { embed: true, origin: window.location.origin })
    : null;
  const fallbackUrl = paymentId && !configError ? checkoutUrl(props, paymentId) : null;

  // Reset per payment.
  useEffect(() => {
    setReady(false);
    setProblem(null);
    paid.current = false;
  }, [paymentId, open]);

  useEffect(() => {
    if (!open) return;
    if (configError) {
      setProblem(configError);
      callbacks.current.onError?.(new Error(configError));
    }
  }, [open, configError]);

  // Messages from the checkout frame.
  useEffect(() => {
    if (!open || !paymentId) return;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (event: MessageEvent) => {
      const message = readAevifyMessage(event, props.baseUrl, paymentId, frameRef.current?.contentWindow);
      if (!message) return;
      switch (message.type) {
        case "ready":
          setReady(true);
          break;
        case "resize":
          if (Number.isFinite(message.height)) setHeight(Math.min(Math.max(message.height, 320), 900));
          break;
        case "payment.paid":
          paid.current = true;
          callbacks.current.onSuccess?.({ paymentId, txHash: message.txHash });
          if (closeOnSuccess) closeTimer = setTimeout(() => callbacks.current.onClose(), 2000);
          break;
        case "payment.cancelled":
          callbacks.current.onCancel?.({ paymentId });
          callbacks.current.onClose();
          break;
        case "error": {
          const text =
            message.reason === "origin_not_allowed"
              ? "This site isn't in your Aevify allowed domains (Dashboard → Developers)."
              : message.reason === "invalid_publishable_key"
                ? "The publishable key doesn't belong to this payment's store."
                : "The checkout couldn't be embedded here.";
          setProblem(text);
          callbacks.current.onError?.(new Error(text));
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [open, paymentId, props.baseUrl, closeOnSuccess]);

  // If the frame never says hello (blocked by the browser, network trouble), offer a new tab.
  useEffect(() => {
    if (!open || ready || problem || !src) return;
    const t = setTimeout(() => setProblem("The checkout is taking too long to load here."), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [open, ready, problem, src]);

  // Escape to close, and no page scrolling behind the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    if (!paid.current && paymentId) callbacks.current.onCancel?.({ paymentId });
    callbacks.current.onClose();
  }

  if (!open || typeof document === "undefined") return null;

  let body: ReactNode;
  if (problem) {
    body = (
      <div style={styles.status} role="alert">
        <p style={{ margin: 0, color: "#0f172a", fontWeight: 500 }}>Couldn&apos;t open the checkout here</p>
        <p style={{ margin: "8px 0 16px" }}>{problem}</p>
        {fallbackUrl && (
          <a href={fallbackUrl} target="_blank" rel="noopener" style={styles.link}>
            Open the checkout in a new tab
          </a>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {!ready && <div style={styles.status}>Loading checkout…</div>}
        {src && (
          <iframe
            ref={frameRef}
            src={src}
            title="Aevify checkout"
            allow="clipboard-write"
            style={{ ...styles.frame, height: ready ? height : 0 }}
          />
        )}
      </>
    );
  }

  return createPortal(
    <div style={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && dismiss()} data-aevify-checkout="">
      <div style={styles.panel} role="dialog" aria-modal="true" aria-label="Checkout">
        <button type="button" onClick={dismiss} style={styles.close} aria-label="Close checkout">
          ✕
        </button>
        {body}
      </div>
    </div>,
    document.body,
  );
}
