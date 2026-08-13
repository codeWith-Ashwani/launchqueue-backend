function rankUpEmail({ waitlistName, oldPosition, newPosition, shareUrl }) {
  return `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-bottom: 4px;">You moved up! 🚀</h2>
    <p style="color: #666;">Someone joined <strong>${waitlistName}</strong> using your link.</p>

    <div style="text-align: center; margin: 32px 0;">
      <p style="color: #999; font-size: 13px; text-decoration: line-through;">#${oldPosition}</p>
      <p style="font-size: 40px; font-weight: 600; margin: 4px 0;">#${newPosition}</p>
      <p style="color: #999; font-size: 13px;">your new position</p>
    </div>

    <p style="color: #333;">Keep sharing to climb even higher.</p>

    <div style="background: #f5f5f5; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #666; word-break: break-all; margin: 16px 0;">
      ${shareUrl}
    </div>

    <p style="color: #999; font-size: 12px; margin-top: 32px;">Sent by LaunchQueue</p>
  </div>
  `;
}

module.exports = rankUpEmail;