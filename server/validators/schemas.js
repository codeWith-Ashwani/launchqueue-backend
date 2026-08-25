const { z } = require("zod");

const registerSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address"),
  password: z
    .string({ required_error: "Password is required", invalid_type_error: "Password must be a string" })
    .min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address"),
  password: z
    .string({ required_error: "Password is required", invalid_type_error: "Password must be a string" })
    .min(1, "Password is required"),
});

const updateProfileSchema = z
  .object({
    name: z.string().trim().max(100, "Name cannot exceed 100 characters").optional(),
    email: z.string().trim().toLowerCase().email("Please enter a valid email address").optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.email !== undefined,
    { message: "At least one field (name or email) must be provided" }
  );

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: "Current password is required", invalid_type_error: "Current password must be a string" })
      .min(1, "Current password is required"),
    newPassword: z
      .string({ required_error: "New password is required", invalid_type_error: "New password must be a string" })
      .min(6, "New password must be at least 6 characters"),
  })
  .refine(
    (data) => data.newPassword !== data.currentPassword,
    { message: "New password must be different from current password", path: ["newPassword"] }
  );

const createWaitlistSchema = z.object({
  name: z
    .string({ required_error: "Waitlist name is required", invalid_type_error: "Waitlist name must be a string" })
    .trim()
    .min(1, "Waitlist name is required"),
  description: z.string().optional().default(""),
});

const featureItemSchema = z.object({
  icon: z.string().optional().default("✨"),
  title: z.string({ required_error: "Feature title is required" }).min(1, "Feature title is required"),
  description: z.string().optional().default(""),
});

const milestoneItemSchema = z.object({
  referrals: z
    .number({ required_error: "Referral count is required", invalid_type_error: "Referral count must be a number" })
    .int("Referral count must be an integer")
    .positive("Referral count must be greater than 0"),
  reward: z.string({ required_error: "Reward is required" }).min(1, "Reward description is required"),
});

const updateWaitlistSchema = z.object({
  name: z.string().trim().min(1, "Waitlist name cannot be empty").optional(),
  description: z.string().optional(),
  thankYouMessage: z.string().optional(),
  paused: z.boolean().optional(),
  heroHeadline: z.string().optional(),
  heroSubheadline: z.string().optional(),
  heroImageUrl: z.string().optional(),
  accentColor: z.string().optional(),
  ctaText: z.string().optional(),
  features: z.array(featureItemSchema).optional(),
  milestones: z.array(milestoneItemSchema).optional(),
});

const signupJoinSchema = z.object({
  email: z
    .string({ required_error: "Email is required", invalid_type_error: "Email must be a string" })
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address"),
  ref: z.string().trim().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  createWaitlistSchema,
  updateWaitlistSchema,
  signupJoinSchema,
};
