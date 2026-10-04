jest.mock("nodemailer", () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({ accepted: true }) })) }));
describe("Configured SMTP transport", () => {
  let original;
  beforeEach(() => {
    original = { ...process.env }; jest.resetModules();
    process.env.EMAIL_PROVIDER = "smtp";
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
    await expect(require("../../utils/sendEmail")({ to: "recipient@example.com" })).rejects.toThrow("Email delivery must be mocked");
  });
});

describe("Brevo HTTPS delivery", () => {
  let originalEnv, originalFetch;
  const message = { to: "recipient@example.com", subject: "Verify", html: "<p>Private proof link</p>", messageId: "<outbox-id@launchqueue>" };
  beforeEach(() => {
    originalEnv = { ...process.env }; originalFetch = global.fetch;
    jest.resetModules(); jest.clearAllMocks();
    process.env.NODE_ENV = "development"; process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "synthetic-api-key"; process.env.EMAIL_FROM = "sender@example.com";
    process.env.EMAIL_FROM_NAME = "LaunchQueue Demo";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: "provider-id" }) });
  });
  afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; });
  it("sends HTML over HTTPS with the configured sender and a bounded request", async () => {
    await require("../../utils/sendEmail")(message);
    const [url, request] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request).toMatchObject({ method: "POST", redirect: "error", headers: { "api-key": "synthetic-api-key" } });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.body)).toEqual({
      sender: { email: "sender@example.com", name: "LaunchQueue Demo" },
      to: [{ email: message.to }], subject: message.subject, htmlContent: message.html,
      headers: { "X-Launchqueue-Message-Id": message.messageId },
    });
    expect(require("nodemailer").createTransport.mock.results[0].value.sendMail).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])("rejects HTTP %s without exposing the response body", async (status) => {
    const json = jest.fn().mockResolvedValue({ message: "Private email and api key" });
    global.fetch.mockResolvedValue({ ok: false, status, json });
    await expect(require("../../utils/sendEmail")(message)).rejects.toThrow(`Brevo rejected email (HTTP ${status})`);
    expect(json).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { messageId: "" }])("requires a provider receipt before reporting success: %j", async (receipt) => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => receipt });
    await expect(require("../../utils/sendEmail")(message)).rejects.toThrow("invalid receipt");
  });
  it("rejects an unreadable provider receipt", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error("private response"); } });
    await expect(require("../../utils/sendEmail")(message)).rejects.toThrow("Brevo returned an invalid receipt");
  });
  it.each([["TimeoutError", "Brevo request timed out"], ["Error", "Brevo request failed"]])("sanitizes %s transport errors", async (name, expected) => {
    global.fetch.mockRejectedValue(Object.assign(new Error("private transport details"), { name }));
    await expect(require("../../utils/sendEmail")(message)).rejects.toThrow(expected);
  });
  it("blocks all real providers in test mode", async () => {
    process.env.NODE_ENV = "test";
    await expect(require("../../utils/sendEmail")(message)).rejects.toThrow("Email delivery must be mocked");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
