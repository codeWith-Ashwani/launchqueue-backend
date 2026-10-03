const crypto = require("crypto");
const request = require("supertest");
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "billing-lifecycle-test-secret";
process.env.LEMONSQUEEZY_PRO_VARIANT_ID = "pro-variant";
const app = require("../../index");
const Founder = require("../../models/Founder");
const BillingEvent = require("../../models/BillingEvent");
const generateToken = require("../../utils/generateToken");
const { effectivePlan } = require("../../services/entitlements");
const { connectDb, clearDb, closeDb } = require("../setupDb");
describe("Billing lifecycle and replay handling", () => {
  let founder; let timestamp;
  beforeAll(connectDb, 30000); afterAll(closeDb);
  beforeEach(async () => {
    await clearDb(); timestamp = Date.now();
    founder = await Founder.create({ email: "billing@example.com" });
  });
  function event(status, offset = 0, extra = {}, name = "subscription_updated", id = "subscription-1") {
    return { meta: { event_name: name, custom_data: { founder_id: founder._id.toString() } },
      data: { type: "subscriptions", id, attributes: { status, variant_id: "pro-variant", updated_at: new Date(timestamp + offset).toISOString(), ...extra } } };
  }
  function webhook(payload) {
    const body = JSON.stringify(payload);
    return request(app).post("/api/payments/webhook").set("Content-Type", "application/json")
      .set("X-Signature", crypto.createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET).update(body).digest("hex")).send(body);
  }
  it("deduplicates concurrent webhook deliveries and ignores older updates", async () => {
    const payload = event("active");
    expect((await Promise.all(Array.from({ length: 4 }, () => webhook(payload)))).every((r) => r.status === 200)).toBe(true);
    expect(await BillingEvent.countDocuments()).toBe(1);
    await webhook(event("expired", -60000));
    expect((await Founder.findById(founder._id)).plan).toBe("pro");
    expect((await BillingEvent.findOne({ outcome: "stale" })).eventName).toBe("subscription_updated");
  });
  it("keeps cancelled access until the end date and enforces expiry even without another webhook", async () => {
    const endsAt = new Date(Date.now() + 60000);
    await webhook(event("cancelled", 0, { ends_at: endsAt.toISOString() }, "subscription_cancelled"));
    const owner = await Founder.findById(founder._id);
    expect(effectivePlan(owner)).toBe("pro");
    expect(effectivePlan(owner, new Date(endsAt.getTime() + 1))).toBe("free");
  });
  it("handles resume, delinquency and expiry as explicit access decisions", async () => {
    await webhook(event("past_due"));
    expect((await Founder.findById(founder._id)).plan).toBe("pro");
    await webhook(event("unpaid", 1000));
    expect((await Founder.findById(founder._id)).plan).toBe("free");
    await webhook(event("active", 2000, {}, "subscription_resumed"));
    expect((await Founder.findById(founder._id)).plan).toBe("pro");
    await webhook(event("expired", 3000, {}, "subscription_expired"));
    expect((await Founder.findById(founder._id)).plan).toBe("free");
  });
  it("ignores old subscription and test-mode events", async () => {
    await webhook(event("active", 0, {}, "subscription_created", "new-subscription"));
    await webhook(event("expired", 1000, {}, "subscription_expired", "old-subscription"));
    await webhook(event("expired", 2000, { test_mode: true }, "subscription_expired", "new-subscription"));
    expect((await Founder.findById(founder._id)).plan).toBe("pro");
  });
  it("rejects malformed signed payloads and malformed signature lengths", async () => {
    expect((await webhook({ meta: { event_name: "subscription_updated" }, data: {} })).status).toBe(400);
    expect((await request(app).post("/api/payments/webhook").set("X-Signature", "00").send({})).status).toBe(401);
  });
  it("refreshes the provider portal instead of returning an expired saved link", async () => {
    await Founder.updateOne({ _id: founder._id }, { $set: { lemonSqueezySubscriptionId: "subscription-1", customerPortalUrl: "https://old.example" } });
    process.env.LEMONSQUEEZY_API_KEY = "test-api-key";
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { attributes: { urls: { customer_portal: "https://fresh.lemonsqueezy.com/billing" } } } }) });
    try {
      const result = await request(app).get("/api/payments/portal").set("Authorization", `Bearer ${generateToken(founder._id)}`);
      expect(result.body.portalUrl).toBe("https://fresh.lemonsqueezy.com/billing");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally { fetchSpy.mockRestore(); delete process.env.LEMONSQUEEZY_API_KEY; }
  });
});
