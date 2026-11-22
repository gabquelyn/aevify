/**
 * @aevify/react: a Pay button and checkout modal for Aevify.
 *
 *   <AevifyButton
 *     publishableKey="pk_test_..."
 *     baseUrl="https://aevify.vercel.app"
 *     createPayment={() => fetch("/api/checkout", { method: "POST" }).then((r) => r.json())}
 *     onSuccess={({ paymentId }) => router.push(`/orders/thanks?payment=${paymentId}`)}
 *   />
 *
 * The wallet and payment logic live on Aevify's hosted checkout; this package only opens it.
 */
export { AevifyButton, type AevifyButtonProps } from "./button.tsx";
export { AevifyCheckout, type AevifyCheckoutProps } from "./checkout.tsx";
export { checkoutUrl, readAevifyMessage, type AevifyConfig, type AevifyMessage, type CheckoutResult } from "./core.ts";
