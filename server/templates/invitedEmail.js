function invitedEmail({ waitlistName, thankYouMessage }) {
  return `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 8px;">You've been invited! 🎉</h2>
    <p style="color: #666; line-height: 1.5;">
      Great news! You have been granted early access to <strong>${waitlistName}</strong>.
    </p>

    <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0; color: #333; line-height: 1.5;">
      <p style="margin: 0; font-weight: 500;">Founder message:</p>
      <p style="margin: 8px 0 0 0; color: #555;">
        ${thankYouMessage || "You've been invited — check your inbox from the team for next steps."}
      </p>
    </div>

    <p style="color: #999; font-size: 12px; line-height: 1.4; margin-top: 24px;">
      Thank you for being an early supporter.
    </p>

    <p style="color: #999; font-size: 12px; margin-top: 32px;">Sent by LaunchQueue</p>
  </div>
  `;
}

module.exports = invitedEmail;
