const calculatePosition = require("../../utils/calculatePosition");

describe("calculatePosition Unit Tests", () => {
  it("calculates normal referral gains at 5 spots per referral", () => {
    expect(calculatePosition(100, 1)).toBe(95);
    expect(calculatePosition(100, 3)).toBe(85);
    expect(calculatePosition(50, 5)).toBe(25);
  });

  it("returns base position when referral count is zero", () => {
    expect(calculatePosition(1, 0)).toBe(1);
    expect(calculatePosition(42, 0)).toBe(42);
    expect(calculatePosition(1000, 0)).toBe(1000);
  });

  it("ensures position never drops below 1 even with excessive referrals", () => {
    expect(calculatePosition(10, 5)).toBe(1); // 10 - 25 = -15 -> 1
    expect(calculatePosition(5, 1)).toBe(1);  // 5 - 5 = 0 -> 1
    expect(calculatePosition(1, 100)).toBe(1);
  });

  it("handles boundary base positions correctly", () => {
    expect(calculatePosition(6, 1)).toBe(1);
    expect(calculatePosition(7, 1)).toBe(2);
  });
});
