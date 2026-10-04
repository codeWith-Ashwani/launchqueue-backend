const nodemailer = require("nodemailer");
const { emailProvider, brevoConfig } = require("../config/email");

const transporter = nodemailer.createTransport({
  ...(process.env.EMAIL_HOST ? {
    host: process.env.EMAIL_HOST, port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === "true" || Number(process.env.EMAIL_PORT) === 465,
  } : { service: "gmail" }),
  disableFileAccess: true,
  disableUrlAccess: true,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail({ to, subject, html, messageId }) {
    if (process.env.NODE_ENV === "test") throw new Error("Email delivery must be mocked in tests");
    if (emailProvider() === "brevo") {
      const { apiKey, sender } = brevoConfig();
      let response;
      try {
        response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            sender, to: [{ email: to }], subject, htmlContent: html,
            ...(messageId ? { headers: { "X-Launchqueue-Message-Id": messageId } } : {}),
          }),
        });
      } catch (err) {
        // Do not expose transport errors or provider response bodies containing private data.
        // eslint-disable-next-line preserve-caught-error -- Transport causes may contain credentials or private message data.
        throw new Error(err.name === "TimeoutError" ? "Brevo request timed out" : "Brevo request failed");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Brevo rejected email (HTTP ${response.status})`);
      }
      let receipt;
      try { receipt = await response.json(); }
      catch { throw new Error("Brevo returned an invalid receipt"); }
      if (typeof receipt?.messageId !== "string" || !receipt.messageId.trim()) {
        throw new Error("Brevo returned an invalid receipt");
      }
      return;
    }
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"LaunchQueue" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      messageId,
    });
}

module.exports = sendEmail;
