const disposableDomains = require("disposable-email-domains");

function isDisposableEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  return disposableDomains.includes(domain);
}

module.exports = isDisposableEmail;