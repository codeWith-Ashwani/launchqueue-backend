const { generateDesign } = require("../../services/campaignDesign");
const draft = require("../fixtures/campaignDesign");
const input = { name: "Maker Studio", description: "A workspace for independent makers", preferences: { brief: "Calm editorial design, olive and cream.", tone: "calm", audience: "Makers", layout: "auto", accentColor: "" } };
describe("Gemini design transport", () => {
  let original;
  beforeEach(() => { original = { ...process.env }; process.env.GEMINI_API_KEY = "synthetic-gemini-key"; });
  afterEach(() => { process.env = original; });
  const response = (value, finishReason = "STOP") => ({ ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
  it("uses a server-only key and validates structured page output", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(draft));
    expect(await generateDesign(input, { fetchImpl })).toEqual(draft);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).not.toContain("synthetic-gemini-key");
    expect(options.headers["x-goog-api-key"]).toBe("synthetic-gemini-key");
    const body = JSON.parse(options.body);
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(input);
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
});
