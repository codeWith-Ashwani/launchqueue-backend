const { z } = require("zod");
const { pageDesignSchema, imageUrl, color } = require("./campaignDesign");

const registerSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .max(254).email("Please enter a valid email address"),
  password: z
    .string({ required_error: "Password is required", invalid_type_error: "Password must be a string" })
    .min(6, "Password must be at least 6 characters").refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password cannot exceed 72 bytes"),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .max(254).email("Please enter a valid email address"),
  password: z
    .string({ required_error: "Password is required", invalid_type_error: "Password must be a string" })
    .min(1, "Password is required").max(256),
});

const updateProfileSchema = z
  .object({
    name: z.string().trim().max(100, "Name cannot exceed 100 characters").optional(),
    email: z.string().trim().toLowerCase().max(254).email("Please enter a valid email address").optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.email !== undefined,
    { message: "At least one field (name or email) must be provided" }
  );

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: "Current password is required", invalid_type_error: "Current password must be a string" })
      .min(1, "Current password is required").max(256),
    newPassword: z
      .string({ required_error: "New password is required", invalid_type_error: "New password must be a string" })
      .min(6, "New password must be at least 6 characters").refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password cannot exceed 72 bytes"),
  })
  .refine(
    (data) => data.newPassword !== data.currentPassword,
    { message: "New password must be different from current password", path: ["newPassword"] }
  );

const requestPasswordResetSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .max(254).email("Please enter a valid email address"),
});

const resetPasswordSchema = z.object({
  token: z
    .string({ required_error: "Reset token is required", invalid_type_error: "Reset token must be a string" })
    .min(1, "Reset token is required").max(128),
  newPassword: z
    .string({ required_error: "New password is required", invalid_type_error: "New password must be a string" })
    .min(6, "New password must be at least 6 characters").refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password cannot exceed 72 bytes"),
});

const createWaitlistSchema = z.object({
  name: z
    .string({ required_error: "Waitlist name is required", invalid_type_error: "Waitlist name must be a string" })
    .trim()
    .min(1, "Waitlist name is required").max(100),
  description: z.string().max(4000).optional().default(""),
  heroHeadline: z.string().max(4000).optional(),
  heroSubheadline: z.string().max(4000).optional(),
  heroImageUrl: imageUrl.optional(),
  accentColor: color.optional(),
  ctaText: z.string().max(4000).optional(),
  features: z.array(z.object({ icon: z.string().max(16), title: z.string().min(1).max(120), description: z.string().max(600) })).max(6).optional(),
  pageDesign: pageDesignSchema.optional(),
  thankYouMessage: z.string().max(4000).optional(),
  milestones: z.array(z.object({ referrals: z.number().int().positive(), reward: z.string().min(1).max(200) })).max(20).optional(),
});

const featureItemSchema = z.object({
  icon: z.string().max(4000).optional().default("✨"),
  title: z.string({ required_error: "Feature title is required" }).min(1, "Feature title is required").max(120),
  description: z.string().max(4000).optional().default(""),
});

const milestoneItemSchema = z.object({
  referrals: z
    .number({ required_error: "Referral count is required", invalid_type_error: "Referral count must be a number" })
    .int("Referral count must be an integer")
    .positive("Referral count must be greater than 0"),
  reward: z.string({ required_error: "Reward is required" }).min(1, "Reward description is required").max(200),
});

const updateWaitlistSchema = z.object({
  name: z.string().trim().min(1, "Waitlist name cannot be empty").max(100).optional(),
  description: z.string().max(4000).optional(),
  thankYouMessage: z.string().max(4000).optional(),
  paused: z.boolean().optional(),
  heroHeadline: z.string().max(4000).optional(),
  heroSubheadline: z.string().max(4000).optional(),
  heroImageUrl: imageUrl.optional(),
  accentColor: color.optional(),
  ctaText: z.string().max(4000).optional(),
  features: z.array(featureItemSchema).max(20).optional(),
  milestones: z.array(milestoneItemSchema).max(20).optional(),
  pageDesign: pageDesignSchema.optional(),
});

const signupJoinSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .max(254).email("Please enter a valid email address"),
  ref: z.string().trim().max(32).optional(),
});
const verificationSchema = z.object({ token: z.string().min(1).max(2048) });

const updatePositionSchema = z.object({
  currentPosition: z
    .number({ required_error: "Position is required", invalid_type_error: "Position must be a number" })
    .int("Position must be an integer")
    .positive("Position must be a positive integer"),
});

const batchInviteSchema = z.object({
  signupIds: z
    .array(z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid signup ID"), { required_error: "signupIds array is required" })
    .min(1, "At least one signup ID must be provided").max(100),
});

const visitSchema = z.object({ visitorId: z.string().trim().min(1).max(128) });
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
const funnelQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });

module.exports = {
  visitSchema,
  paginationSchema,
  funnelQuerySchema,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  createWaitlistSchema,
  updateWaitlistSchema,
  signupJoinSchema,
  verificationSchema,
  updatePositionSchema,
  batchInviteSchema,
};
