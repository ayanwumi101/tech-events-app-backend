import { env } from "../config/env.js";

interface SendOtpInput {
  toEmail: string;
  fullName: string;
  otp: string;
  expiresInMinutes: number;
}

const buildOtpEmailHtml = ({
  fullName,
  otp,
  expiresInMinutes,
}: SendOtpInput): string => {
  return `
  <div style="font-family: Inter, Arial, sans-serif; background:#f5f7fb; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:white; border-radius:14px; padding:24px; border:1px solid #e5e7eb;">
      <h2 style="margin:0 0 12px; color:#111827;">EventScout Email Verification</h2>
      <p style="margin:0 0 16px; color:#4b5563;">Hi ${fullName}, use this OTP code to verify your email:</p>
      <div style="font-size:28px; font-weight:800; letter-spacing:4px; color:#4f46e5; margin:0 0 16px;">${otp}</div>
      <p style="margin:0; color:#6b7280;">This code will expire in ${expiresInMinutes} minute(s).</p>
    </div>
  </div>
  `;
};

export const sendOtpEmail = async ({
  toEmail,
  fullName,
  otp,
  expiresInMinutes,
}: SendOtpInput): Promise<{ sent: boolean; reason?: string }> => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return {
      sent: false,
      reason: "Resend API key or sender email is missing.",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [toEmail],
        subject: "Your EventScout verification code",
        html: buildOtpEmailHtml({
          toEmail,
          fullName,
          otp,
          expiresInMinutes,
        }),
      }),
    });

    if (!response.ok) {
      return {
        sent: false,
        reason: `Resend request failed with ${response.status}`,
      };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown email delivery failure",
    };
  }
};
