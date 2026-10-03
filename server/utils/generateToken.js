const jwt = require("jsonwebtoken");

function generateToken(founderId, sessionVersion = 0) {
  return jwt.sign({ id: founderId, sessionVersion }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

module.exports = generateToken;
