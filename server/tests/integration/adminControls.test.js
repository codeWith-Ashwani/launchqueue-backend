const request = require("supertest");
const app = require("../../index");
const Founder = require("../../models/Founder");
const Waitlist = require("../../models/Waitlist");
const Signup = require("../../models/Signup");
const generateToken = require("../../utils/generateToken");
const { connectDb, closeDb, clearDb } = require("../setupDb");

describe("Admin Controls (Position Override & Batch Invite) Integration Tests", () => {
  let founder1;
  let token1;
  let founder2;
  let token2;
  let waitlist1;
  let waitlist2;
  let signup1;
  let signup2;
  let otherSignup;

  beforeAll(async () => {
    await connectDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await clearDb();

    founder1 = await Founder.create({
      email: "founder1@admin.com",
      password: "password123",
      plan: "pro",
    });
    token1 = generateToken(founder1._id);

    founder2 = await Founder.create({
      email: "founder2@admin.com",
      password: "password123",
      plan: "pro",
    });
    token2 = generateToken(founder2._id);

    waitlist1 = await Waitlist.create({
      founderId: founder1._id,
      name: "Main Launch",
      slug: "main-launch",
      thankYouMessage: "Welcome to the VIP beta!",
    });

    waitlist2 = await Waitlist.create({
      founderId: founder2._id,
      name: "Other Launch",
      slug: "other-launch",
    });

    signup1 = await Signup.create({
      waitlistId: waitlist1._id,
      email: "sub1@example.com",
      refCode: "REF_SUB1",
      basePosition: 1,
      currentPosition: 5,
      status: "waiting",
    });

    signup2 = await Signup.create({
      waitlistId: waitlist1._id,
      email: "sub2@example.com",
      refCode: "REF_SUB2",
      basePosition: 2,
      currentPosition: 10,
      status: "waiting",
    });

    otherSignup = await Signup.create({
      waitlistId: waitlist2._id,
      email: "other@example.com",
      refCode: "REF_OTHER",
      basePosition: 1,
      currentPosition: 1,
      status: "waiting",
    });
  });

  describe("PATCH /api/waitlists/:id/signups/:signupId/position", () => {
    it("successfully updates a signup's position", async () => {
      const res = await request(app)
        .patch(`/api/waitlists/${waitlist1._id}/signups/${signup1._id}/position`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ currentPosition: 1 });

      expect(res.status).toBe(200);
      expect(res.body.signup.currentPosition).toBe(1);

      const dbSignup = await Signup.findById(signup1._id);
      expect(dbSignup.currentPosition).toBe(1);
    });

    it("returns 404 when updating a signup that belongs to a different waitlist", async () => {
      const res = await request(app)
        .patch(`/api/waitlists/${waitlist1._id}/signups/${otherSignup._id}/position`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ currentPosition: 1 });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 404 when waitlist is not owned by the authenticated founder", async () => {
      const res = await request(app)
        .patch(`/api/waitlists/${waitlist1._id}/signups/${signup1._id}/position`)
        .set("Authorization", `Bearer ${token2}`)
        .send({ currentPosition: 1 });

      expect(res.status).toBe(404);
    });

    it("returns 400 when currentPosition is zero or negative", async () => {
      const resZero = await request(app)
        .patch(`/api/waitlists/${waitlist1._id}/signups/${signup1._id}/position`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ currentPosition: 0 });

      expect(resZero.status).toBe(400);

      const resNeg = await request(app)
        .patch(`/api/waitlists/${waitlist1._id}/signups/${signup1._id}/position`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ currentPosition: -5 });

      expect(resNeg.status).toBe(400);
    });
  });

  describe("POST /api/waitlists/:id/signups/batch-invite", () => {
    it("successfully updates status to invited for selected signups", async () => {
      const res = await request(app)
        .post(`/api/waitlists/${waitlist1._id}/signups/batch-invite`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ signupIds: [signup1._id.toString(), signup2._id.toString()] });

      expect(res.status).toBe(200);
      expect(res.body.invitedCount).toBe(2);

      const updated1 = await Signup.findById(signup1._id);
      const updated2 = await Signup.findById(signup2._id);
      expect(updated1.status).toBe("invited");
      expect(updated2.status).toBe("invited");
    });

    it("silently excludes signup IDs from other waitlists and reports accurate invitedCount", async () => {
      const res = await request(app)
        .post(`/api/waitlists/${waitlist1._id}/signups/batch-invite`)
        .set("Authorization", `Bearer ${token1}`)
        .send({
          signupIds: [signup1._id.toString(), otherSignup._id.toString()],
        });

      expect(res.status).toBe(200);
      expect(res.body.invitedCount).toBe(1);

      const updated1 = await Signup.findById(signup1._id);
      const uninvitedOther = await Signup.findById(otherSignup._id);
      expect(updated1.status).toBe("invited");
      expect(uninvitedOther.status).toBe("waiting"); // unmodified
    });

    it("returns 404 when batch inviting on a waitlist you don't own", async () => {
      const res = await request(app)
        .post(`/api/waitlists/${waitlist1._id}/signups/batch-invite`)
        .set("Authorization", `Bearer ${token2}`)
        .send({ signupIds: [signup1._id.toString()] });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error", "Waitlist not found");
    });

    it("returns 400 when signupIds array is empty", async () => {
      const res = await request(app)
        .post(`/api/waitlists/${waitlist1._id}/signups/batch-invite`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ signupIds: [] });

      expect(res.status).toBe(400);
    });
  });
});
