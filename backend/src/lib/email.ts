import { config } from "../config.js";
import { logger } from "./logger.js";
import { query } from "../db.js";

/**
 * Brevo transactional email (HTTPS API — no SMTP socket management).
 * All sends are logged to notification_log; failures never crash a
 * request path (email is best-effort).
 */

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  kind: string;
  userId?: string | null;
}

export async function sendEmail({ to, subject, html, kind, userId }: SendArgs): Promise<boolean> {
  if (!config.BREVO_API_KEY) {
    logger.warn({ kind, to }, "BREVO_API_KEY not set — email skipped");
    return false;
  }
  let status = "sent";
  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": config.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: config.BREVO_SENDER_EMAIL, name: config.BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      status = `error:${res.status}`;
      logger.error({ kind, to, status: res.status, body: await res.text() }, "brevo send failed");
    }
  } catch (err) {
    status = "error:network";
    logger.error({ err, kind, to }, "brevo send exception");
  }
  try {
    await query(
      "INSERT INTO notification_log (user_id, kind, recipient, subject, status) VALUES ($1,$2,$3,$4,$5)",
      [userId ?? null, kind, to, subject, status],
    );
  } catch (err) {
    logger.error({ err }, "failed to log notification");
  }
  return status === "sent";
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0f1a;font-family:Segoe UI,Arial,sans-serif;color:#e6e9f2">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:22px;font-weight:700;letter-spacing:.5px;margin-bottom:4px">🧬 ImpactDNA</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:24px">Retroactive Public Goods Funding on GenLayer</div>
    <div style="background:#131a2b;border:1px solid #1f2940;border-radius:12px;padding:28px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#fff">${title}</h2>
      ${body}
    </div>
    <div style="color:#5b6270;font-size:12px;margin-top:20px">You received this because you have an ImpactDNA account.</div>
  </div></body></html>`;
}

export function welcomeEmail(displayName: string, walletAddress: string): { subject: string; html: string } {
  return {
    subject: "Welcome to ImpactDNA — your wallet is ready",
    html: shell(
      `Welcome, ${displayName}!`,
      `<p style="line-height:1.6;color:#c6cbd9">Your account was created and a permanent blockchain wallet was generated for you. It survives device changes, reinstalls and cache clears.</p>
       <p style="background:#0b0f1a;border-radius:8px;padding:12px;font-family:monospace;font-size:13px;word-break:break-all;color:#7ee0a3">${walletAddress}</p>
       <p style="line-height:1.6;color:#c6cbd9">Register your GitHub identity, submit your open-source work, and let validator consensus judge its real downstream impact.</p>`,
    ),
  };
}

export function resetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: "Reset your ImpactDNA password",
    html: shell(
      "Password reset requested",
      `<p style="line-height:1.6;color:#c6cbd9">Click the button below to choose a new password. This link expires in 30 minutes and can be used once.</p>
       <p style="text-align:center;margin:24px 0"><a href="${resetUrl}" style="background:#635bff;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">Reset password</a></p>
       <p style="line-height:1.6;color:#8b93a7;font-size:13px">If you did not request this, you can safely ignore this email.</p>`,
    ),
  };
}

export function notifyEmail(title: string, message: string): { subject: string; html: string } {
  return {
    subject: `ImpactDNA — ${title}`,
    html: shell(title, `<p style="line-height:1.6;color:#c6cbd9">${message}</p>`),
  };
}
