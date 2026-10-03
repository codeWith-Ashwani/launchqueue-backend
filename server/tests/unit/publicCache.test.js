const publicCache = require("../../services/publicCache");
describe("Optional public cache", () => {
  it("uses cached masked data without recomputing", async () => {
    const compute = jest.fn(); const masked = { email: "a***@e***.com" };
    expect(await publicCache("public-key", compute, 10, { status: "ready", get: async () => JSON.stringify(masked) })).toEqual(masked);
    expect(compute).not.toHaveBeenCalled();
  });
  it("falls back to Mongo computation when Redis reads and writes fail", async () => {
    const compute = jest.fn().mockResolvedValue({ leaderboard: [] });
    const client = { status: "ready", get: jest.fn().mockRejectedValue(new Error("Offline")), set: jest.fn().mockRejectedValue(new Error("Offline")) };
    expect(await publicCache("public-key", compute, 10, client)).toEqual({ leaderboard: [] });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
