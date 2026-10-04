const { z } = require("zod");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
const imageUrl = z.union([z.literal(""), z.url().max(2000).refine((url) => url.startsWith("https://"), "Images must use HTTPS")]);
const item = z.object({ title: z.string().min(1).max(120), description: z.string().max(600) }).strict();
const sectionTypes = ["features", "story", "steps", "faq", "rewards", "leaderboard"];
const pageDesignSchema = z.object({
  layout: z.enum(["centered", "split", "editorial"]),
  backgroundColor: color,
  surfaceColor: color,
  fontFamily: z.enum(["sans", "serif", "mono"]),
  cornerStyle: z.enum(["sharp", "rounded", "pill"]),
  backgroundStyle: z.enum(["solid", "gradient", "grid"]),
  eyebrow: z.string().max(80),
  signupHeading: z.string().max(100),
  featureHeading: z.string().max(120),
  rewardHeading: z.string().max(120),
  logoUrl: imageUrl,
  sectionOrder: z.array(z.enum(sectionTypes)).max(6).refine((values) => new Set(values).size === values.length, "Sections cannot repeat"),
  story: z.object({ title: z.string().max(120), body: z.string().max(1500) }).strict(),
  steps: z.array(item).max(6),
  faq: z.array(z.object({ question: z.string().min(1).max(160), answer: z.string().max(600) }).strict()).max(6),
}).strict();
const designDraftSchema = z.object({
  heroHeadline: z.string().min(1).max(180),
  heroSubheadline: z.string().max(600),
  ctaText: z.string().min(1).max(60),
  accentColor: color,
  features: z.array(z.object({ icon: z.string().max(16), title: z.string().min(1).max(120), description: z.string().max(600) }).strict()).max(6),
  pageDesign: pageDesignSchema,
}).strict();
const generateDesignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(4000).default(""),
  preferences: z.object({
    brief: z.string().trim().min(10, "Describe your brand in at least 10 characters").max(2000),
    audience: z.string().max(300).default(""),
    tone: z.enum(["professional", "playful", "calm", "bold"]).default("professional"),
    layout: z.enum(["auto", "centered", "split", "editorial"]).default("auto"),
    accentColor: z.union([z.literal(""), color]).default(""),
  }).strict(),
}).strict();
module.exports = { pageDesignSchema, designDraftSchema, generateDesignSchema, imageUrl, color };
