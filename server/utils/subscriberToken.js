const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function secret() {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update("launchqueue-subscriber-status")
    .digest("hex");
}
function issueSubscriberToken(signup) {
  return jwt.sign(
    {
      signupId: signup._id.toString(),
      waitlistId: signup.waitlistId.toString(),
    },
    secret(),
    {
      expiresIn: "7d",
      audience: "subscriber-status",
      issuer: "launchqueue",
    },
  );
}
function verifySubscriberToken(token) {
  return jwt.verify(token, secret(), {
    audience: "subscriber-status",
    issuer: "launchqueue",
    algorithms: ["HS256"],
  });
}
module.exports = { issueSubscriberToken, verifySubscriberToken };
