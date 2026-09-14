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

export const mailService = {
  sendPasswordResetEmail,
};
