jest.mock("nodemailer", () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({ accepted: true }) })) }));
describe("Configured SMTP transport", () => {
  let original;
  beforeEach(() => {
    original = { ...process.env }; jest.resetModules();
    process.env.EMAIL_HOST = "smtp.example.com"; process.env.EMAIL_PORT = "465"; process.env.EMAIL_FROM = "sender@example.com";
  });
  afterEach(() => { process.env = original; });
  it("uses the configured host, secure port and bounded timeouts", async () => {
    process.env.NODE_ENV = "development";
    const sendEmail = require("../../utils/sendEmail"); const nodemailer = require("nodemailer");
    await sendEmail({ to: "recipient@example.com", subject: "Test", html: "Hello", messageId: "stable-id" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.com", port: 465, secure: true, socketTimeout: 30000 }));
    expect(nodemailer.createTransport.mock.results[0].value.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "sender@example.com", messageId: "stable-id" }));
  });
  it("propagates provider errors so the queue can retry", async () => {
    process.env.NODE_ENV = "development";
    const sendEmail = require("../../utils/sendEmail"); const nodemailer = require("nodemailer");
    nodemailer.createTransport.mock.results[0].value.sendMail.mockRejectedValue(new Error("Provider unavailable"));
    await expect(sendEmail({ to: "recipient@example.com" })).rejects.toThrow("Provider unavailable");
  });
  it("blocks accidental real SMTP in test mode", async () => {
    process.env.NODE_ENV = "test";
    await expect(require("../../utils/sendEmail")({ to: "recipient@example.com" })).rejects.toThrow("SMTP delivery must be mocked");
  });
});
