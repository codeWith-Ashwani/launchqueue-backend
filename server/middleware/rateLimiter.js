const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const RedisRateStore = require("../services/redisRateStore");
function createLimiter(
  prefix,
  windowMs,
  limit,
  { client, skipTests = true } = {},
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    ...(client || process.env.REDIS_URL
      ? { store: new RedisRateStore(prefix, client) }
      : {}),
    passOnStoreError: false,
    message: { error: "Too many requests. Please try again later." },
    skip: () => skipTests && process.env.NODE_ENV === "test",
  });
}
module.exports = {
  createLimiter,
  signupLimiter: createLimiter("signup", 300000, 5),
  authLimiter: createLimiter("auth", 900000, 20),
  recoveryLimiter: createLimiter("recovery", 300000, 5),
  verificationLimiter: createLimiter("verification", 300000, 20),
  statusLimiter: createLimiter("status", 60000, 60),
  visitLimiter: createLimiter("visit", 60000, 30),
};
