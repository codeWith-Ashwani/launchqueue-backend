const router = require("express").Router();
const { createLimiter } = require("../middleware/rateLimiter");
const validateQuery = require("../middleware/validateQuery");
router.get("/leaderboard", createLimiter("product-discovery", 60000, 90), validateQuery(require("../validators/platform").leaderboardQuery), require("../controllers/discoveryController").leaderboard);
module.exports = router;
