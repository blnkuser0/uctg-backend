import { Resend } from "resend";
import { config } from "../config";
import { logger } from "../utils/logger";

// Never make a real network call from tests, even if a real key is sitting
// in .env for local dev use — dotenv.config() in config/index.ts loads it
// unconditionally, so this guard has to be explicit rather than relying on
// the key simply being absent.
const resend = config.resend.apiKey && config.env !== "test" ? new Resend(config.resend.apiKey) : null;

async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!resend) {
    logger.warn({ to }, "RESEND_API_KEY is not set — skipping password reset email send");
    return;
  }

  const { error } = await resend.emails.send({
    from: config.resend.fromEmail,
    to,
    subject: "Reset your Ugnexa Catalyst password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0891b2;">Reset your password</h2>
        <p>We received a request to reset the password for your Ugnexa Catalyst account.</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; background: #0891b2; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
            Reset password
          </a>
        </p>
        <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  // The Resend SDK returns { error } rather than throwing on an API-level
  // failure (e.g. an unverified sending domain) — log it so it's visible in
  // server logs, but don't throw: the caller (forgot-password) must still
  // respond 200 either way, to avoid leaking which emails are registered.
  if (error) {
    logger.error({ to, error }, "Failed to send password reset email via Resend");
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildAccountCreatedEmail(input: { name: string; email: string; password: string; loginUrl: string }) {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.password);
  const loginUrl = escapeHtml(input.loginUrl);

  return {
    subject: "Your Ugnexa Catalyst account is ready",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0891b2;">Welcome to Ugnexa Catalyst</h2>
        <p>Hi ${name}, an account has been created for you. Use these details to sign in:</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 16px 4px 0; color: #64748b;">Email</td><td style="padding: 4px 0;"><strong>${email}</strong></td></tr>
          <tr><td style="padding: 4px 16px 4px 0; color: #64748b;">Temporary password</td><td style="padding: 4px 0;"><strong style="font-family: monospace; font-size: 15px;">${password}</strong></td></tr>
        </table>
        <p>
          <a href="${loginUrl}" style="display: inline-block; background: #0891b2; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
            Sign in
          </a>
        </p>
        <p><strong>Please change this password</strong> after you sign in (Profile → Security), then delete this email.</p>
      </div>
    `,
  };
}

/** Emails a newly created account its login details. Returns whether the email
 *  was actually sent, so the admin can be told to share the password another
 *  way when it wasn't — a mail failure must never fail account creation. */
async function sendAccountCreatedEmail(input: { to: string; name: string; password: string }): Promise<boolean> {
  if (!resend) {
    logger.warn({ to: input.to }, "RESEND_API_KEY is not set — skipping account credentials email");
    return false;
  }

  const { subject, html } = buildAccountCreatedEmail({
    name: input.name,
    email: input.to,
    password: input.password,
    loginUrl: `${config.server.clientUrl}/login`,
  });

  try {
    const { error } = await resend.emails.send({ from: config.resend.fromEmail, to: input.to, subject, html });
    if (error) {
      logger.error({ to: input.to, error }, "Failed to send account credentials email via Resend");
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ to: input.to, error }, "Failed to send account credentials email via Resend");
    return false;
  }
}

export const mailService = {
  sendPasswordResetEmail,
  sendAccountCreatedEmail,
};
