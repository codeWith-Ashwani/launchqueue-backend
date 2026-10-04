const router = require("express").Router();
const express = require("express");
const { z } = require("zod");
const { recordVital } = require("../services/telemetry");
const routes = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/dashboard/new",
  "/dashboard/:id",
  "/dashboard/:id/settings",
  "/profile",
  "/pricing",
  "/admin",
  "/admin/login",
  "/w/:slug",
  "/w/:slug/welcome",
  "unmatched",
];
const schema = z
  .object({
    metrics: z
      .array(
        z
          .object({
            name: z.enum(["LCP", "INP", "CLS"]),
            route: z.enum(routes),
            value: z.number().finite().min(0).max(3600000),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
router.use(
  require("../middleware/rateLimiter").createLimiter("web-vitals", 60000, 30),
);
router.post(
  "/vitals",
  express.text({ type: "text/plain", limit: "2kb" }),
  (req, res) => {
    // CORS alone cannot reject beacon writes; validate the origin before recording.
    const allowed = [
      process.env.CLIENT_URL,
      ...(process.env.NODE_ENV === "production"
        ? []
        : ["http://localhost:5173"]),
    ];
    if (!req.headers.origin || !allowed.includes(req.headers.origin))
      return res.sendStatus(403);
    let payload;
    try {
      payload = schema.parse(
        typeof req.body === "string" ? JSON.parse(req.body) : req.body,
      );
    } catch {
      return res
        .status(400)
        .json({ error: "Invalid performance measurements" });
    }
    for (const metric of payload.metrics)
      recordVital(metric.name, metric.route, metric.value);
    res.sendStatus(204);
  },
);
module.exports = router;
