const generateRefCode = require("../../utils/generateRefCode");

describe("generateRefCode Unit Tests", () => {
  it("generates a string of exact length 8", () => {
    const code = generateRefCode();
    expect(typeof code).toBe("string");
    expect(code).toHaveLength(8);
  });

  it("only contains characters from the non-ambiguous alphabet", () => {
    const allowedChars = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;
    for (let i = 0; i < 50; i++) {
      const code = generateRefCode();
      expect(code).toMatch(allowedChars);
      // Ensure ambiguous characters (0, o, 1, l, i) are never present
      expect(code).not.toMatch(/[0o1li]/);
    }
  });

  it("generates unique codes across multiple iterations", () => {
    const set = new Set();
    const count = 100;
    for (let i = 0; i < count; i++) {
      set.add(generateRefCode());
    }
    expect(set.size).toBe(count);
  });
});
