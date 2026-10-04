const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
if (process.env.NODE_ENV !== "test") require("dotenv").config();

const validateEnv = require("./utils/validateEnv");

// Fail-fast environment variable validation
validateEnv();

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
const browserRequest = require("./middleware/browserRequest");
app.use(require("./middleware/requestTrace"));
const PORT = process.env.PORT || 5000;
const { redisHealth, closeRedis } = require("./config/redis");

app.get("/health", (_req, res) => res.json({ status: "alive" }));
app.get("/ready", async (_req, res) => {
  const database = mongoose.connection.readyState === 1;
  res.status(database ? 200 : 503).json({ status: database ? "ready" : "unavailable", database, redis: await redisHealth() });
});

// Security headers with Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // allow swagger-ui CDN scripts/styles
  })
);

// Cookie parser for httpOnly auth tokens
app.use(cookieParser());

// Raw parser for Lemon Squeezy webhook signature verification
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));

// Interactive Swagger UI API Documentation
const swaggerDocument = YAML.load(path.join(__dirname, "openapi.yaml"));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get("/", (req, res) => {
  res.json({
    message: "LaunchQueue API is running 🚀",
    documentation: "/api/docs",
  });
});

const allowedOrigins = [
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]),
  process.env.CLIENT_URL,
].filter(Boolean);

const strictCors = cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
});

const openCors = cors({
  origin: true,
  credentials: true,
});

app.use("/api/auth", browserRequest, strictCors, require("./routes/auth"));
app.use("/api/waitlists", browserRequest, strictCors, require("./routes/waitlists"));
app.use("/api/payments", (req, res, next) => req.path === "/webhook" ? next() : browserRequest(req, res, next), strictCors, require("./routes/payments"));
app.use("/api/w", openCors, require("./routes/signups"));

// Centralized error handler
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ type: "request_error", requestId: req.requestId, code: err.code || "INTERNAL", status: err.status || 500 }));

  const statusCode = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";

  res.status(statusCode).json({
    error: isProd && statusCode === 500 ? "Internal server error" : (err.message || "Something went wrong"),
  });
});

if (require.main === module) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      console.log("✅ MongoDB connected");

      const server = app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📚 Interactive API docs available at http://localhost:${PORT}/api/docs`);
      });
      const shutdown = () => server.close(async () => { await closeRedis(); await mongoose.disconnect(); });
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", err.message);
      process.exit(1);
    });
}

module.exports = app;
