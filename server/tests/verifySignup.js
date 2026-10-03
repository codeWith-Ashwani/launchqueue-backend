const request = require("supertest");
const Signup = require("../models/Signup");
const { issueVerificationToken } = require("../utils/verificationToken");
async function verifySignup(app, slug, email) {
  const signup = await Signup.findOne({ email });
  return request(app).post(`/api/w/${slug}/verify`).send({ token: issueVerificationToken(signup) });
}
module.exports = verifySignup;
