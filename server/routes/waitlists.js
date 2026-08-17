const express = require("express");
const router = express.Router();
const { create, list, getOne , update } = require("../controllers/waitlistController");
const authMiddleware = require("../middleware/authMiddleware");
const { getStats, exportCsv } = require("../controllers/dashboardController");

router.use(authMiddleware); // every route below requires a valid founder

router.post("/", create);
router.get("/", list);
router.get("/:id", getOne);
router.get("/:id/stats", getStats);
router.get("/:id/export", exportCsv);
router.patch("/:id", update);

module.exports = router;