function aiConfig() {
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (model.length > 100 || !/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/.test(model)) {
    throw Object.assign(new Error("Invalid GROQ_MODEL"), { status: 503 });
  }
  return { provider: "groq", model, keyVariable: "GROQ_API_KEY", apiKey: process.env.GROQ_API_KEY?.trim() || "" };
}

module.exports = { aiConfig };
