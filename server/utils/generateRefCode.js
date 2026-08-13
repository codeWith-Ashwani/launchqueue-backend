const { customAlphabet } = require("nanoid");

// Lowercase letters + numbers, no ambiguous characters (no 0/o/1/l/i)
const nanoid = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

function generateRefCode() {
  return nanoid();
}

module.exports = generateRefCode;