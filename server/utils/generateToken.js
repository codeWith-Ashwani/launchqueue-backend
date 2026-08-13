const jwt = require("jsonwebtoken");

function generateToken(founderId) {
  return jwt.sign({ id: founderId }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

module.exports = generateToken;