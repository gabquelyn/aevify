import { useState, type CSSProperties, type ReactNode } from "react";
import { AevifyCheckout } from "./checkout.tsx";
import { checkoutUrl, prefersRedirect, validateConfig, type AevifyConfig, type CheckoutResult } from "./core.ts";

type PaymentSource =
  /** An existing payment ID (created on your server). */
  | { paymentId: string; createPayment?: never }
  /** Called on click: ask your server to create the payment, return its ID. */
  | { paymentId?: never; createPayment: () => Promise<string | { id: string } | { paymentId: string }> };

export type AevifyButtonProps = AevifyConfig &
  PaymentSource & {
    /** "auto" (default): modal on desktop, full-page redirect on phones. */
    mode?: "auto" | "modal" | "redirect";
    onSuccess?: (result: CheckoutResult) => void;
    onCancel?: (result: { paymentId: string }) => void;
    onError?: (error: Error) => void;
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    disabled?: boolean;
  };

const defaultStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "10px 20px",
  border: "none",
  borderRadius: 999,
  background: "#0ea5e9",
  color: "#ffffff",
  font: "500 14px ui-sans-serif, system-ui, -apple-system, sans-serif",
  cursor: "pointer",
};

/** A Pay button that opens the Aevify checkout. Unstyled if you pass className. */
export function AevifyButton(props: AevifyButtonProps) {
  const { mode = "auto", onSuccess, onCancel, onError, children, className, style, disabled } = props;
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function resolvePaymentId(): Promise<string> {
    if (props.paymentId) return props.paymentId;
    const result = await props.createPayment!();
    const id = typeof result === "string" ? result : "id" in result ? result.id : result.paymentId;
    if (!id?.startsWith("pay_")) throw new Error("createPayment must return the Aevify payment ID (pay_...).");
    return id;
  }

  async function handleClick() {
    const configError = validateConfig(props);
    if (configError) {
      onError?.(new Error(configError));
      console.error(`[@aevify/react] ${configError}`);
      return;
    }
    setBusy(true);
    try {
      const id = await resolvePaymentId();
      if (mode === "redirect" || (mode === "auto" && prefersRedirect())) {
        // successUrl / cancelUrl set when the payment was created bring the customer back.
        window.location.assign(checkoutUrl(props, id));
        return;
      }
      setPaymentId(id);
      setOpen(true);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        className={className}
        style={className ? style : { ...defaultStyle, opacity: disabled || busy ? 0.6 : 1, ...style }}
        aria-busy={busy || undefined}
      >
        {children ?? "Pay with Aevify"}
      </button>
      <AevifyCheckout
        publishableKey={props.publishableKey}
        baseUrl={props.baseUrl}
        paymentId={paymentId}
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onError={onError}
      />
    </>
  );
}
