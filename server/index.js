const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 5000;



app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json());

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.json({
    message: "LaunchQueue API is running 🚀",
  });
});

const strictCors = cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
});
const openCors = cors({ origin: true }); // public routes — embeddable on any site

app.use("/api/auth", strictCors, require("./routes/auth"));
app.use("/api/waitlists", strictCors, require("./routes/waitlists"));
app.use("/api/payments", strictCors, require("./routes/payments"));
app.use("/api/w", openCors, require("./routes/signups"));

app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(500).json({
    error: err.message || "Something went wrong",
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });