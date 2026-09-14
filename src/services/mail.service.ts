import { Resend } from "resend";
import { config } from "../config";
import { logger } from "../utils/logger";

const resend = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;

async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!resend) {
    logger.warn({ to }, "RESEND_API_KEY is not set — skipping password reset email send");
    return;
  }

  await resend.emails.send({
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
}

export const mailService = {
  sendPasswordResetEmail,
};
