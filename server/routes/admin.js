const router = require("express").Router();
const validate = require("../middleware/validate");
const validateQuery = require("../middleware/validateQuery");
const { listQuery, moderationSchema } = require("../validators/platform");
const controller = require("../controllers/adminController");
router.use(require("../middleware/authMiddleware"), require("../middleware/adminMiddleware"));
router.use(require("../middleware/rateLimiter").createLimiter("admin-console", 60000, 90));
router.get("/overview", controller.overview);
router.get("/founders", validateQuery(listQuery), controller.founders);
router.get("/campaigns", validateQuery(listQuery), controller.campaigns);
router.get("/subscribers", validateQuery(listQuery), controller.subscribers);
router.patch("/campaigns/:id/discovery", (req, res, next) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid resource ID" });
  next();
}, validate(moderationSchema), controller.moderate);
module.exports = router;
