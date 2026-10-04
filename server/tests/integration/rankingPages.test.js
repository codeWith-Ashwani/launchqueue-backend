const mongoose = require("mongoose");
const Signup = require("../../models/Signup");
const { rankedPage, rankedSignups, pagePipeline, rankedReferrers } = require("../../services/ranking");
const { connectDb, closeDb, clearDb } = require("../setupDb");
beforeAll(connectDb); afterAll(closeDb); beforeEach(clearDb);
afterEach(() => jest.restoreAllMocks());

it("matches full queue ranks across ties, fractional overrides, referrals, legacy members and pending boundaries", async () => {
  const waitlistId = new mongoose.Types.ObjectId();
  await Signup.insertMany(Array.from({ length: 173 }, (_, i) => ({ waitlistId, email: `page${i}@example.com`, refCode: `PAGE${i}`,
    basePosition: i + 1, currentPosition: i + 1, referralCount: i % 7, priorityOffset: i % 9 === 0 ? -12.25 : i % 5 === 0 ? 0.5 : 0,
    verificationState: i % 4 === 0 ? "pending" : i % 3 === 0 ? "legacy" : "verified" })));
  // Equal scores and sequences still use ObjectId as the final eligible tie break.
  await Signup.updateMany({ refCode: { $in: ["PAGE10", "PAGE11"] } }, { $set: { basePosition: 8, referralCount: 0, priorityOffset: 0 } });
  const full = await rankedSignups(waitlistId);
  const pages = [];
  for (let page = 1; page <= 9; page++) pages.push(...await rankedPage(waitlistId, page, 23));
  expect(pages.map((row) => [row._id.toString(), row.currentPosition])).toEqual(full.map((row) => [row._id.toString(), row.currentPosition]));
  expect(pages.some((row) => row.currentPosition === null)).toBe(true);
  expect(pages.every((row) => !Object.hasOwn(row, "queueEligible"))).toBe(true);
  expect(await rankedPage(new mongoose.Types.ObjectId(), 1, 50)).toEqual([]);
  const codes = ["PAGE0", "PAGE1", "PAGE10", "PAGE11", "PAGE22", "PAGE100"];
  const referrers = await rankedReferrers(waitlistId, codes);
  expect(referrers.map((row) => [row.refCode, row.currentPosition]).sort()).toEqual(full.filter((row) => row.queueEligible && codes.includes(row.refCode)).map((row) => [row.refCode, row.currentPosition]).sort());
  expect(await rankedReferrers(waitlistId, ["MISSING"])).toEqual([]);
});
it("lets MongoDB bound the page sort and uses the campaign index", async () => {
  const waitlistId = new mongoose.Types.ObjectId();
  await Signup.insertMany(Array.from({ length: 150 }, (_, i) => ({ waitlistId, email: `explain${i}@example.com`, refCode: `EXPLAIN${i}`, basePosition: i + 1, currentPosition: i + 1 })));
  const explain = await Signup.aggregate(pagePipeline(waitlistId, 2, 50)).explain("executionStats");
  const cursor = explain.stages.find((stage) => stage.$cursor).$cursor;
  expect(cursor.executionStats.totalDocsExamined).toBe(150);
  expect(JSON.stringify(cursor.queryPlanner.winningPlan)).toContain("IXSCAN");
  const sort = explain.stages.find((stage) => stage.$sort);
  expect(Number(sort.$sort.limit)).toBe(100);
  expect(explain.stages.some((stage) => stage.$_internalSetWindowFields)).toBe(false);
});
it("keeps targeted ranks consistent if a referral changes between candidate and count reads", async () => {
  const waitlistId = new mongoose.Types.ObjectId();
  await Signup.insertMany(Array.from({ length: 15 }, (_, i) => ({ waitlistId, email: `snapshot${i}@example.com`, refCode: `SNAP${i}`, basePosition: i + 1, currentPosition: i + 1, verificationState: "verified" })));
  const originalAggregate = Signup.aggregate.bind(Signup);
  jest.spyOn(Signup, "aggregate").mockImplementationOnce((pipeline) => {
    const query = originalAggregate(pipeline), execute = query.exec.bind(query);
    query.exec = async () => { await Signup.updateOne({ refCode: "SNAP10" }, { $set: { referralCount: 10 } }); return execute(); };
    return query;
  });
  const before = await rankedReferrers(waitlistId, ["SNAP10"]);
  expect(before[0]).toMatchObject({ referralCount: 0, currentPosition: 11 });
  const after = await rankedReferrers(waitlistId, ["SNAP10"]);
  expect(after[0]).toMatchObject({ referralCount: 10, currentPosition: 1 });
});
