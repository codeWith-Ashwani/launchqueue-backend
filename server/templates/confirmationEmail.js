function confirmationEmail({ waitlistName, position, shareUrl }) {
  return `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 4px;">You're on the list! 🎉</h2>
    <p style="color: #666;">You just joined the <strong>${waitlistName}</strong> waitlist.</p>

    <div style="text-align: center; margin: 32px 0;">
      <p style="font-size: 40px; font-weight: 600; margin: 0;">#${position}</p>
      <p style="color: #999; font-size: 13px; margin-top: 4px;">your current position</p>
    </div>

    <p style="color: #333;">Want to move up? Share your personal link — every signup through it moves you closer to #1.</p>

    <div style="background: #f5f5f5; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #666; word-break: break-all; margin: 16px 0;">
      ${shareUrl}
    </div>

    <p style="color: #999; font-size: 12px; margin-top: 32px;">Sent by LaunchQueue</p>
  </div>
  `;
}

module.exports = confirmationEmail;