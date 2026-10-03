module.exports = function statusEmail({ statusUrl }) {
  // URL is generated from trusted configuration and a signed URL-safe token.
  return `<p>Open your private LaunchQueue status page:</p><p><a href="${statusUrl}">View your position and rewards</a></p><p>This link expires in seven days. Keep it private; share your referral link instead.</p>`;
};
