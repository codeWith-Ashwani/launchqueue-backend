function passwordResetEmail({ resetUrl }) {
  return `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 8px;">Reset your password 🔐</h2>
    <p style="color: #666; line-height: 1.5;">We received a request to reset the password for your LaunchQueue founder account.</p>

    <div style="margin: 28px 0; text-align: center;">
      <a href="${resetUrl}" style="background: #111; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; display: inline-block;">
        Reset Password
      </a>
    </div>

    <p style="color: #666; font-size: 13px; line-height: 1.5;">
      If the button above does not work, copy and paste this link into your browser:
    </p>
    <div style="background: #f5f5f5; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #555; word-break: break-all; margin: 12px 0;">
      ${resetUrl}
    </div>

    <p style="color: #999; font-size: 12px; line-height: 1.4; margin-top: 24px;">
      This link is single-use and will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>

    <p style="color: #999; font-size: 12px; margin-top: 32px;">Sent by LaunchQueue</p>
  </div>
  `;
}

module.exports = passwordResetEmail;
