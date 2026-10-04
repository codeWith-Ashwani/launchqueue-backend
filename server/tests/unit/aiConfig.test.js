const { aiConfig } = require("../../config/ai");
describe("AI provider configuration", () => {
  let original;
  beforeEach(() => {
    original = { ...process.env };
    for (const key of ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"]) delete process.env[key];
  });
  afterEach(() => { process.env = original; });
  it("keeps a deployed Gemini configuration working when no provider is specified", () => {
    process.env.GEMINI_API_KEY = "legacy-key";
    expect(aiConfig()).toMatchObject({ provider: "gemini", apiKey: "legacy-key" });
  });
  it("selects Groq when its key is added alongside a legacy Gemini key", () => {
    process.env.GROQ_API_KEY = " new-key "; process.env.GEMINI_API_KEY = "legacy-key";
    expect(aiConfig()).toMatchObject({ provider: "groq", apiKey: "new-key" });
  });
  it("honors an explicit provider even if another provider has a key", () => {
    process.env.AI_PROVIDER = "groq"; process.env.GEMINI_API_KEY = "legacy-key";
    expect(aiConfig()).toMatchObject({ provider: "groq", apiKey: "" });
    process.env.GROQ_API_KEY = "new-key"; process.env.AI_PROVIDER = "gemini";
    expect(aiConfig()).toMatchObject({ provider: "gemini", apiKey: "legacy-key" });
  });
  it("accepts a namespaced Groq model without using a stale Gemini model", () => {
    process.env.AI_PROVIDER = "groq"; process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GEMINI_MODEL = "stale invalid value";
    expect(aiConfig().model).toBe("openai/gpt-oss-120b");
  });
  it.each(["unknown", "https://example.com"])("rejects an unsupported provider: %s", (provider) => {
    process.env.AI_PROVIDER = provider;
    expect(() => aiConfig()).toThrow("AI_PROVIDER must be groq or gemini");
  });
  it.each(["https://example.com/model", "model?secret=value", "x".repeat(101)])("rejects an invalid Groq model without exposing its value", (model) => {
    process.env.AI_PROVIDER = "groq"; process.env.GROQ_MODEL = model;
    expect(() => aiConfig()).toThrow("Invalid GROQ_MODEL");
  });
});
