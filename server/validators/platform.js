const { z } = require("zod");
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid resource ID");
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).default(""),
  founderId: id.optional(), waitlistId: id.optional(),
}).strict();
const leaderboardQuery = z.object({
  period: z.enum(["week", "all"]).default("week"),
  limit: z.coerce.number().int().min(1).max(24).default(12),
}).strict();
const moderationSchema = z.object({ discoveryHidden: z.boolean() }).strict();
module.exports = { listQuery, leaderboardQuery, moderationSchema };
