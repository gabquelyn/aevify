import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

/**
 * Transactional email through the Brevo SMTP relay.
 *
 * Needs BREVO_SMTP_LOGIN and BREVO_SMTP_KEY (an SMTP key, not a Brevo API key) and an
 * EMAIL_FROM address that is a verified sender in Brevo.
 *
 * Without SMTP settings (local development), emails are printed to the server log
 * instead, so sign-in still works: copy the link from `docker compose logs web`.
 */

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  const smtp = env.smtp();
  if (!smtp) return undefined;
  transporter ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return transporter;
}

export type Email = { to: string; subject: string; text: string; html: string };

export async function sendEmail(email: Email): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    if (env.isProduction()) {
      throw new Error("Email isn't configured: set BREVO_SMTP_LOGIN, BREVO_SMTP_KEY and EMAIL_FROM.");
    }
    console.info(`\n[email] SMTP not configured, printing instead.\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
    return;
  }
  await transport.sendMail({ from: env.emailFrom(), ...email });
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The sign-in email. Plain, light layout matching the Aevify theme. */
export function magicLinkEmail(to: string, url: string): Email {
  const safeUrl = escapeHtml(url);
  return {
    to,
    subject: "Your Aevify sign-in link",
    text: `Sign in to Aevify:\n\n${url}\n\nThis link expires in 10 minutes and can be used once. If you didn't ask for it, you can ignore this email.`,
    html: `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
        <tr><td style="font-size:15px;font-weight:600"><span style="color:#0ea5e9">&#9650;</span> Aevify</td></tr>
        <tr><td style="padding-top:24px;font-size:22px;font-weight:600;letter-spacing:-0.02em">Sign in to Aevify</td></tr>
        <tr><td style="padding-top:8px;font-size:15px;line-height:1.6;color:#64748b">Click the button below to sign in. The link expires in 10 minutes and works once.</td></tr>
        <tr><td style="padding-top:24px">
          <a href="${safeUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px">Sign in</a>
        </td></tr>
        <tr><td style="padding-top:24px;font-size:12px;line-height:1.6;color:#94a3b8">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${safeUrl}</span></td></tr>
        <tr><td style="padding-top:24px;font-size:12px;color:#94a3b8">Didn't ask for this? You can ignore this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
}
