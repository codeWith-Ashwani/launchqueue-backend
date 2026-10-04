const {
  generateDesign,
  reserveGeneration,
} = require("../services/campaignDesign");
const { aiConfig } = require("../config/ai");
async function generate(req, res) {
  try {
    if (!aiConfig().apiKey)
      return res
        .status(503)
        .json({
          error:
            "AI design is not configured yet. You can still customize the page manually.",
        });
    await reserveGeneration(req.founder._id);
    const design = await generateDesign(req.body);
    res.json({ design });
  } catch (err) {
    console.error("Campaign design failed", {
      requestId: req.requestId,
      status: err.status || 500,
      code: err.code,
      providerStatus: err.providerStatus,
    });
    res
      .status(err.status || 500)
      .json({
        error: err.status
          ? err.message
          : "Could not generate a design. Your draft is unchanged.",
        ...(err.providerStatus
          ? { code: err.code, providerStatus: err.providerStatus }
          : {}),
      });
  }
}
module.exports = { generate };
