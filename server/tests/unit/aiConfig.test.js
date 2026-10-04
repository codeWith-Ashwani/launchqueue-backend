const { aiConfig } = require("../../config/ai");
describe("Groq configuration", () => {
  let original;
  beforeEach(() => {
    original = { ...process.env };
    for (const key of ["GROQ_API_KEY", "GROQ_MODEL"]) delete process.env[key];
  });
  afterEach(() => { process.env = original; });
  it("uses Groq as the only provider even when no key is configured", () => {
    expect(aiConfig()).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b", apiKey: "" });
  });
  it("trims the server key without exposing it in the model name", () => {
    process.env.GROQ_API_KEY = " new-key ";
    expect(aiConfig()).toMatchObject({ provider: "groq", apiKey: "new-key" });
  });
  it("accepts a namespaced Groq model", () => {
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    expect(aiConfig().model).toBe("openai/gpt-oss-20b");
  });
  it.each(["https://example.com/model", "model?secret=value", "x".repeat(101)])("rejects an invalid Groq model without exposing its value", (model) => {
    process.env.GROQ_MODEL = model;
    expect(() => aiConfig()).toThrow("Invalid GROQ_MODEL");
  });
});
