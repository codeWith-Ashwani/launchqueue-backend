function aiConfig() {
  // Keep existing Gemini deployments working; prefer Groq when its key is added.
  const provider = process.env.AI_PROVIDER || (process.env.GROQ_API_KEY?.trim() ? "groq" : "gemini");
  if (!["groq", "gemini"].includes(provider)) throw Object.assign(new Error("AI_PROVIDER must be groq or gemini"), { status: 503 });
  const keyVariable = provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
  const modelVariable = provider === "groq" ? "GROQ_MODEL" : "GEMINI_MODEL";
  const model = process.env[modelVariable] || (provider === "groq" ? "openai/gpt-oss-120b" : "gemini-3.5-flash-lite");
  const validModel = provider === "groq" ? /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/ : /^[a-zA-Z0-9._-]+$/;
  if (model.length > 100 || !validModel.test(model)) throw Object.assign(new Error(`Invalid ${modelVariable}`), { status: 503 });
  return { provider, model, keyVariable, modelVariable, apiKey: process.env[keyVariable]?.trim() || "" };
}

module.exports = { aiConfig };
