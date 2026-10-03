const nodemailer = require("nodemailer");

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
    if (process.env.NODE_ENV === "test") throw new Error("SMTP delivery must be mocked in tests");
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"LaunchQueue" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
      messageId,
    });
}

module.exports = sendEmail;
