const crypto = require("crypto");
const request = require("supertest");

process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "test_secret_12345";
process.env.LEMONSQUEEZY_PRO_VARIANT_ID = "variant_pro_999";

const app = require("../../index");
const Founder = require("../../models/Founder");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Lemon Squeezy Webhook Integration Tests", () => {
  let founder;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    founder = await Founder.create({
      email: "billing@launchqueue.com",
      password: "password123",
      plan: "free",
    });
  });

  it("returns 401 on invalid webhook signature", async () => {
    const payload = JSON.stringify({
      meta: { event_name: "subscription_created" },
    });

    const res = await request(app)
      .post("/api/payments/webhook")
      .set("x-signature", "invalid_signature_hash")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Invalid signature");
  });

  it("successfully updates founder plan, subscription ID, and portal URL when valid signature is verified", async () => {
    const payloadObject = {
      meta: {
        event_name: "subscription_created",
        custom_data: {
          founder_id: founder._id.toString(),
        },
      },
      data: {
        id: "sub_12345678",
        attributes: {
          status: "active",
          variant_id: "variant_pro_999",
          urls: {
            customer_portal: "https://launchqueue.lemonsqueezy.com/billing/sub_12345678",
          },
        },
      },
    };

    const payloadString = JSON.stringify(payloadObject);
    const validSignature = crypto
      .createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET)
      .update(payloadString)
      .digest("hex");

    const res = await request(app)
      .post("/api/payments/webhook")
      .set("x-signature", validSignature)
      .set("Content-Type", "application/json")
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("received", true);

    const updatedFounder = await Founder.findById(founder._id);
    expect(updatedFounder.plan).toBe("pro");
    expect(updatedFounder.lemonSqueezySubscriptionId).toBe("sub_12345678");
    expect(updatedFounder.customerPortalUrl).toBe("https://launchqueue.lemonsqueezy.com/billing/sub_12345678");
  });
});
