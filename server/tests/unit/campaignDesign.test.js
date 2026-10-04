const { generateDesign } = require("../../services/campaignDesign");
const draft = require("../fixtures/campaignDesign");
const input = { name: "Maker Studio", description: "A workspace for independent makers", preferences: { brief: "Calm editorial design, olive and cream.", tone: "calm", audience: "Makers", layout: "auto", accentColor: "" } };
describe("Gemini design transport", () => {
  let original;
  beforeEach(() => { original = { ...process.env }; process.env.AI_PROVIDER = "gemini"; process.env.GEMINI_API_KEY = "synthetic-gemini-key"; });
  afterEach(() => { process.env = original; });
  const response = (value, finishReason = "STOP") => ({ ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
  it("uses a server-only key and validates structured page output", async () => {
    delete process.env.GEMINI_MODEL;
    const fetchImpl = jest.fn().mockResolvedValue(response(draft));
    expect(await generateDesign(input, { fetchImpl })).toEqual(draft);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).not.toContain("synthetic-gemini-key");
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("synthetic-gemini-key");
    const body = JSON.parse(options.body);
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(input);
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(body.generationConfig.responseFormat.text.schema.properties.pageDesign).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe("error");
  });
  it("respects explicit founder layout/color choices and does not invent logo URLs", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ ...draft, pageDesign: { ...draft.pageDesign, logoUrl: "https://example.com/invented.png" } }));
    const generated = await generateDesign({ ...input, preferences: { ...input.preferences, layout: "split", accentColor: "#123456" } }, { fetchImpl });
    expect(generated.pageDesign.layout).toBe("split"); expect(generated.accentColor).toBe("#123456"); expect(generated.pageDesign.logoUrl).toBe("");
  });
  it.each(["MAX_TOKENS", "SAFETY"])("rejects incomplete/blocked output: %s", async (reason) => {
    await expect(generateDesign(input, { fetchImpl: jest.fn().mockResolvedValue(response(draft, reason)) })).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    { ...draft, pageDesign: { ...draft.pageDesign, layout: "execute-script" } },
    { ...draft, pageDesign: { ...draft.pageDesign, html: "<script>alert(1)</script>" } },
    { ...draft, pageDesign: { ...draft.pageDesign, sectionOrder: ["faq", "faq"] } },
    { ...draft, accentColor: "url(javascript:alert(1))" },
  ])("rejects invalid or unsupported design output", async (value) => {
    await expect(generateDesign(input, { fetchImpl: jest.fn().mockResolvedValue(response(value)) })).rejects.toMatchObject({ status: 502 });
  });
  it("reports provider quota limits without exposing its error body", async () => {
    const json = jest.fn().mockResolvedValue({ error: "private prompt details" });
    await expect(generateDesign(input, { fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 429, json }) })).rejects.toMatchObject({ status: 429 });
    expect(json).not.toHaveBeenCalled();
  });
  it("sanitizes connection errors and prevents accidental real calls in tests", async () => {
    await expect(generateDesign(input, { fetchImpl: jest.fn().mockRejectedValue(new Error("private data")) })).rejects.toMatchObject({ status: 503 });
    await expect(generateDesign(input)).rejects.toThrow("AI requests must be mocked");
  });
  it.each([
    [400, "API_KEY_INVALID", "AI_API_KEY_INVALID"],
    [403, "API_KEY_SERVICE_BLOCKED", "AI_API_ACCESS_DENIED"],
    [404, undefined, "AI_MODEL_UNAVAILABLE"],
    [400, "PRIVATE_UNKNOWN_REASON", "AI_PROVIDER_REQUEST_REJECTED"],
  ])("returns safe diagnostics for provider HTTP %s", async (status, reason, code) => {
    const json = jest.fn().mockResolvedValue({ error: { message: "private prompt and synthetic-gemini-key", details: [{ reason }] } });
    let error;
    try { await generateDesign(input, { fetchImpl: jest.fn().mockResolvedValue({ ok: false, status, json }) }); }
    catch (caught) { error = caught; }
    expect(error).toMatchObject({ status: 502, providerStatus: status, code });
    expect(error.message).not.toMatch(/private prompt|synthetic-gemini-key|PRIVATE_UNKNOWN_REASON/);
    if (reason === "PRIVATE_UNKNOWN_REASON") expect(error).not.toHaveProperty("providerReason");
  });
  it.each([
    ["Your project has been denied access. Please contact support.", "PROJECT_ACCESS_DENIED"],
    ["Your API key was reported as leaked. Please use another API key.", "KEY_BLOCKED"],
    ["Requests to this API method GenerateContent are blocked.", "API_METHOD_BLOCKED"],
    ["Generative Language API has not been used in project 123 before or it is disabled.", "SERVICE_DISABLED"],
    ["User location is not supported for the API use.", "LOCATION_UNSUPPORTED"],
  ])("classifies known access failures without exposing provider response text", async (message, providerReason) => {
    const json = async () => ({ error: { message: `${message} synthetic-gemini-key private prompt` } });
    const error = await generateDesign(input, { fetchImpl: async () => ({ ok: false, status: 403, json }) }).catch((caught) => caught);
    expect(error).toMatchObject({ providerReason, status: 502 });
    expect(error.message).not.toMatch(/synthetic-gemini-key|private prompt/);
  });
});

describe("Groq design transport", () => {
  let original;
  beforeEach(() => {
    original = { ...process.env }; process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "synthetic-groq-key"; delete process.env.GROQ_MODEL;
    process.env.GEMINI_API_KEY = "unused-gemini-key";
  });
  afterEach(() => { process.env = original; });
  const response = (value, finish_reason = "stop", extra = {}) => ({ ok: true,
    json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value), ...extra } }] }) });

  it("sends only the Groq key to the fixed endpoint and requests a closed structured schema", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(draft));
    expect(await generateDesign(input, { fetchImpl })).toEqual(draft);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer synthetic-groq-key");
    expect(options.headers).not.toHaveProperty("x-goog-api-key");
    expect(options.body).not.toMatch(/synthetic-groq-key|unused-gemini-key/);
    expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    const checkObjects = (schema) => {
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required.slice().sort()).toEqual(Object.keys(schema.properties).sort());
        Object.values(schema.properties).forEach(checkObjects);
      }
      if (schema.items) checkObjects(schema.items);
      if (schema.anyOf) schema.anyOf.forEach(checkObjects);
    };
    checkObjects(body.response_format.json_schema.schema);
    expect(body.response_format.json_schema.schema.properties.pageDesign.properties.logoUrl.enum).toEqual([""]);
  });
  it("keeps founder preferences and ignores reasoning content", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(draft, "stop", { reasoning: "private reasoning, never part of the page" }));
    const generated = await generateDesign({ ...input, preferences: { ...input.preferences, layout: "split", accentColor: "#123456" } }, { fetchImpl });
    expect(generated.pageDesign.layout).toBe("split"); expect(generated.accentColor).toBe("#123456");
    expect(JSON.stringify(generated)).not.toContain("private reasoning");
  });
  it.each(["length", "content_filter", "tool_calls"])("rejects incomplete or blocked output: %s", async (reason) => {
    await expect(generateDesign(input, { fetchImpl: async () => response(draft, reason) })).rejects.toMatchObject({ status: 502 });
  });
  it("rejects a refusal even when the completion finish reason is stop", async () => {
    await expect(generateDesign(input, { fetchImpl: async () => response(draft, "stop", { refusal: "not allowed" }) })).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    { ...draft, accentColor: "red" },
    { ...draft, heroHeadline: "x".repeat(181) },
    { ...draft, pageDesign: { ...draft.pageDesign, sectionOrder: ["story", "story"] } },
    { ...draft, pageDesign: { ...draft.pageDesign, html: "<script>bad()</script>" } },
  ])("enforces application validation beyond the provider's structural schema", async (value) => {
    await expect(generateDesign(input, { fetchImpl: async () => response(value) })).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    [400, "AI_PROVIDER_REQUEST_REJECTED", 502], [401, "AI_API_KEY_INVALID", 502],
    [403, "AI_API_ACCESS_DENIED", 502], [404, "AI_MODEL_UNAVAILABLE", 502],
    [429, "AI_PROVIDER_QUOTA", 429], [500, "AI_PROVIDER_UNAVAILABLE", 502],
  ])("reports Groq HTTP %s without leaking raw responses or falling back to Gemini", async (providerStatus, code, status) => {
    const json = jest.fn().mockResolvedValue({ error: { message: "synthetic-groq-key private prompt" } });
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: providerStatus, json });
    const error = await generateDesign(input, { fetchImpl }).catch((caught) => caught);
    expect(error).toMatchObject({ providerStatus, code, status });
    expect(error.message).not.toMatch(/synthetic-groq-key|private prompt|GEMINI_API_KEY/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (providerStatus === 400) expect(json).toHaveBeenCalledTimes(1); else expect(json).not.toHaveBeenCalled();
  });
  it("identifies a rejected generated JSON response without exposing the draft or provider message", async () => {
    const json = async () => ({ error: { code: "json_validate_failed", message: "synthetic-groq-key private prompt", failed_generation: "private content" } });
    const error = await generateDesign(input, { fetchImpl: async () => ({ ok: false, status: 400, json }) }).catch((caught) => caught);
    expect(error).toMatchObject({ status: 502, providerStatus: 400, code: "AI_PROVIDER_REQUEST_REJECTED" });
    expect(error.message).toContain("incomplete design");
    expect(error.message).not.toMatch(/synthetic-groq-key|private prompt|private content/);
  });
  it("does not send a Gemini key when the selected Groq key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const fetchImpl = jest.fn();
    await expect(generateDesign(input, { fetchImpl })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
