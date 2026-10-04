const { EventEmitter } = require("events");
const trace = require("../../middleware/requestTrace");
it("logs route patterns and correlation IDs without query strings or subscriber identities", () => {
  const environment = process.env.NODE_ENV; process.env.NODE_ENV = "development";
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  try {
    const req = { method: "POST", originalUrl: "/w/private?token=secret", body: { email: "private@example.com" }, route: { path: "/:slug/signup" } };
    const res = new EventEmitter(); res.setHeader = jest.fn(); res.statusCode = 202;
    trace(req, res, jest.fn()); res.emit("finish");
    const message = log.mock.calls[0][0]; const parsed = JSON.parse(message);
    expect(parsed.route).toBe("/:slug/signup"); expect(parsed.requestId).toBe(req.requestId);
    expect(message).not.toContain("secret"); expect(message).not.toContain("private@example.com");
  } finally { log.mockRestore(); process.env.NODE_ENV = environment; }
});
