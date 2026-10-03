function emailProvider() {
  const provider = process.env.EMAIL_PROVIDER || "smtp";
  if (!["smtp", "brevo"].includes(provider)) throw new Error("EMAIL_PROVIDER must be smtp or brevo");
  return provider;
}

function brevoConfig() {
  if (!process.env.BREVO_API_KEY?.trim()) throw new Error("Brevo requires BREVO_API_KEY");
  const email = process.env.EMAIL_FROM?.trim();
  if (!email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) {
    throw new Error("Brevo requires EMAIL_FROM to be a verified sender email address without a display name");
  }
  return { apiKey: process.env.BREVO_API_KEY, sender: { email, name: process.env.EMAIL_FROM_NAME || "LaunchQueue" } };
}

module.exports = { emailProvider, brevoConfig };
