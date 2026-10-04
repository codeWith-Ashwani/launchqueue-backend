const crypto = require("crypto");
const jwt = require("jsonwebtoken");
function secret() {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update("launchqueue-email-verification")
    .digest("hex");
}
function issueVerificationToken(signup, expiresIn = "24h") {
  return jwt.sign(
    {
      signupId: signup._id.toString(),
      waitlistId: signup.waitlistId.toString(),
    },
    secret(),
    {
      expiresIn,
      audience: "subscriber-verification",
      issuer: "launchqueue",
    },
  );
}
function verifyVerificationToken(token) {
  return jwt.verify(token, secret(), {
    audience: "subscriber-verification",
    issuer: "launchqueue",
    algorithms: ["HS256"],
  });
}
module.exports = { issueVerificationToken, verifyVerificationToken };
