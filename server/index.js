const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
require("dotenv").config();

const validateEnv = require("./utils/validateEnv");

// Fail-fast environment variable validation
validateEnv();

const app = express();
const PORT = process.env.PORT || 5000;

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

app.use(express.json());
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
  "http://localhost:5173",
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

app.use("/api/auth", strictCors, require("./routes/auth"));
app.use("/api/waitlists", strictCors, require("./routes/waitlists"));
app.use("/api/payments", strictCors, require("./routes/payments"));
app.use("/api/w", openCors, require("./routes/signups"));

// Centralized error handler
app.use((err, req, res, _next) => {
  console.error("Global Error Handler:", err.stack || err.message || err);

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

      app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📚 Interactive API docs available at http://localhost:${PORT}/api/docs`);
      });
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", err.message);
      process.exit(1);
    });
}

module.exports = app;