// Canonical interface. Requests reuse Zod validators; responses describe the wire API.
const { z } = require("zod");
const validators = require("../validators/schemas");
const design = require("../validators/campaignDesign");
const str = { type: "string" }, bool = { type: "boolean" }, num = { type: "number" }, int = { type: "integer", minimum: 0 };
const id = { type: "string", pattern: "^[a-fA-F0-9]{24}$" }, date = { type: "string", format: "date-time" };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (items) => ({ type: "array", items });
const object = (properties, required = Object.keys(properties), additionalProperties = false) => ({ type: "object", properties, required, additionalProperties });
const enumeration = (...values) => ({ type: "string", enum: values });
const jsonSchema = (schema) => { const result = z.toJSONSchema(schema, { target: "draft-7" }); delete result.$schema; return result; };
const plan = enumeration("free", "starter", "pro", "agency");
const schemas = {
  Error: object({ error: str }, ["error"], true), Message: object({ message: str }),
  Founder: object({ id, name: str, email: { ...str, format: "email" }, plan, customerPortalUrl: nullable(str), authProvider: enumeration("local", "google"),
    createdAt: date, subscriptionStatus: str, subscriptionEndsAt: nullable(date), isAdmin: bool }),
  Auth: object({ token: str, founder: ref("Founder") }), Profile: object({ founder: ref("Founder") }),
  Feature: object({ _id: id, icon: str, title: str, description: str }, ["icon", "title", "description"]),
  Milestone: object({ _id: id, referrals: int, reward: str }, ["referrals", "reward"]),
  PageDesign: jsonSchema(design.pageDesignSchema), DesignDraft: jsonSchema(design.designDraftSchema),
  Campaign: object({ _id: id, founderId: id, name: str, slug: str, description: str, thankYouMessage: str, signupSequence: int, queueVersion: int,
    paused: bool, discoverable: bool, discoveryHidden: bool, heroHeadline: str, heroSubheadline: str, heroImageUrl: str, accentColor: str, ctaText: str,
    pageDesign: ref("PageDesign"), features: array(ref("Feature")), milestones: array(ref("Milestone")), createdAt: date, updatedAt: date, __v: int, signupCount: int },
  ["_id", "founderId", "name", "slug", "description", "paused", "discoverable", "accentColor", "features", "milestones", "createdAt", "updatedAt"]),
  CampaignResponse: object({ waitlist: ref("Campaign") }), CampaignList: object({ waitlists: array(ref("Campaign")) }),
  Subscriber: object({ _id: id, waitlistId: id, email: { ...str, format: "email" }, refCode: str, referredBy: nullable(str), basePosition: num, currentPosition: nullable(int),
    initialPosition: num, priorityOffset: num, referralCount: int, invitationState: enumeration("none", "queued", "sent", "failed"),
    verificationState: enumeration("legacy", "pending", "verified"), status: enumeration("waiting", "invited"), verifiedAt: date, createdAt: date, updatedAt: date, __v: int,
    queueScore: num, queueEligible: bool, queueOrder: object({ score: num, sequence: num, id }) }, ["_id", "email", "currentPosition"]),
  Pagination: object({ page: int, limit: int, total: int, totalPages: int }), AdminPagination: object({ page: int, limit: int, total: int, pages: int }),
  Referrer: object({ _id: id, email: str, refCode: str, currentPosition: int, status: str, referralCount: int, totalReferralCount: int }),
  Stats: object({ waitlist: ref("Campaign"), totalVisitors: int, totalSignups: int, verifiedSignups: int, pendingSignups: int, conversionRate: num,
    signupsToday: int, referralRate: num, topReferrers: array(ref("Referrer")), signups: array(ref("Subscriber")),
    chartData: array(object({ date: { ...str, format: "date" }, signups: int })), timezone: enumeration("UTC"), pagination: ref("Pagination") }),
  Funnel: object({ totalPageViews: int, totalVisitors: int, totalSignups: int, directSignups: int, referredSignups: int, conversionRate: num, topReferrers: array(ref("Referrer")) }),
  CampaignSummary: object({ _id: id, name: str, slug: str, paused: bool, discoverable: bool, discoveryHidden: bool, createdAt: date, signupCount: int, confirmedCount: int }),
  FounderOverview: object({ campaigns: array(ref("CampaignSummary")), usage: object({ campaigns: int, signups: int, confirmed: int }), limits: object({ campaigns: nullable(int), signups: nullable(int) }) }),
  Discovery: object({ products: array(object({ name: str, slug: str, description: str, accentColor: str, members: int, weeklyMembers: int, rank: int })),
    period: enumeration("week", "all"), updatedAt: date }),
  PublicCampaign: object({ name: str, description: str, slug: str, paused: bool, totalSignups: int, heroHeadline: str, heroSubheadline: str, heroImageUrl: str,
    accentColor: str, ctaText: str, pageDesign: ref("PageDesign"), features: array(ref("Feature")), milestones: array(ref("Milestone")) },
  ["name", "description", "slug", "paused", "totalSignups", "accentColor", "ctaText", "features", "milestones"]),
  StatusLink: object({ statusLinkSent: { const: true, type: "boolean" }, message: str }),
  SubscriberStatus: object({ position: int, basePosition: num, referralCount: int, positionsGained: num, refCode: str, email: str, waitlistName: str,
    milestones: array(ref("Milestone")), alreadyJoined: bool, statusToken: str }),
  PublicLeaderboard: object({ leaderboard: array(object({ _id: id, rank: int, anonymizedEmail: str, email: str, referralCount: int, currentPosition: int })) }),
  Activity: object({ activities: array(object({ id, userMasked: str, position: int, createdAt: date })) }),
  BatchInvitation: object({ invitedCount: int, queuedCount: int, failedCount: int }),
  AdminFounder: object({ _id: id, name: str, email: str, plan, authProvider: str, subscriptionStatus: str, subscriptionEndsAt: date, createdAt: date,
    effectivePlan: plan, campaignCount: int }, ["_id", "name", "email", "plan", "authProvider", "createdAt", "effectivePlan", "campaignCount"]),
  AdminCampaign: object({ _id: id, name: str, slug: str, founderId: nullable(object({ _id: id, name: str, email: str })), paused: bool, discoverable: bool, discoveryHidden: bool,
    createdAt: date, signupCount: int }),
  AdminSubscriber: object({ _id: id, email: str, waitlistId: nullable(object({ _id: id, name: str, slug: str })), status: str, verificationState: str, invitationState: str,
    referralCount: int, createdAt: date, verifiedAt: date }, ["_id", "email", "waitlistId", "status", "verificationState", "invitationState", "referralCount", "createdAt"]),
  AdminOverview: object({ totals: object({ founders: int, campaigns: int, subscribers: int, pendingVerification: int, newFounders: int, listedProducts: int }),
    delivery: array(object({ _id: str, count: int })), plans: array(object({ _id: object({ plan, status: str }, ["plan"]), count: int })) }),
  Metric: object({ label: str, count: int, failures: int, mean: num, p50: num, p95: num, sampled: int }),
  Diagnostics: object({ scope: str, uptimeSeconds: int, percentiles: str, memoryBytes: object({ rss: int, heapUsed: int }), eventLoopP95Ms: nullable(num),
    requests: array(ref("Metric")), operations: array(ref("Metric")), webVitals: array(ref("Metric")), units: object({ requests: str, operations: str, LCP: str, INP: str, CLS: str }),
    emailOutbox: object({ states: { type: "object", additionalProperties: int }, oldestUnsentAgeSeconds: int }) }),
  MonitoringStorage: object({ enabled: bool, retentionDays: int, bufferedLabels: int, pendingBatches: int, droppedObservations: int, lastPersistedAt: nullable(date) }),
  MonitoringSeries: object({ name: enumeration("http", "operation", "LCP", "INP", "CLS"), label: str, count: int, failures: int, goodRate: num, threshold: num,
    targetGoodRate: num, mean: num, p75UpperBound: nullable(num), p95UpperBound: nullable(num), availability: nullable(num), status: enumeration("warming", "met", "breached") }),
  Monitoring: object({ windowHours: int, storage: ref("MonitoringStorage"), objectives: object({ observedHttpAvailability: num, httpLatencyGoodRate: num, webVitalsGoodRate: num,
    minimumObservations: int, percentiles: str, population: str }), series: array(ref("MonitoringSeries")) }),
  TraceSpan: object({ traceId: str, spanId: str, parentSpanId: nullable(str), name: str, serviceName: str, startedAt: date, durationMs: num, status: int,
    route: str, method: str, responseStatus: int }, ["traceId", "spanId", "parentSpanId", "name", "serviceName", "startedAt", "durationMs", "status"]),
};
const requests = { RegisterRequest: validators.registerSchema, LoginRequest: validators.loginSchema, ProfileRequest: validators.updateProfileSchema,
  PasswordRequest: validators.changePasswordSchema, EmailRequest: validators.requestPasswordResetSchema, ResetRequest: validators.resetPasswordSchema,
  CampaignCreateRequest: validators.createWaitlistSchema, CampaignUpdateRequest: validators.updateWaitlistSchema,
  JoinRequest: validators.signupJoinSchema, VerifyRequest: validators.verificationSchema, PositionRequest: validators.updatePositionSchema,
  InviteRequest: validators.batchInviteSchema, VisitRequest: validators.visitSchema, GenerateDesignRequest: design.generateDesignSchema };
for (const [name, schema] of Object.entries(requests)) schemas[name] = jsonSchema(schema);
const paths = {};
function add(path, method, operationId, response, { body, status = 200, auth = false, query = {}, headers = [], contentType = "application/json" } = {}) {
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: "path", required: true, schema: name === "id" || name === "signupId" ? id : str }));
  for (const [name, schema] of Object.entries(query)) parameters.push({ name, in: "query", schema });
  parameters.push(...headers);
  const operation = { operationId, summary: operationId.replace(/([A-Z])/g, " $1").trim(), parameters,
    responses: { [status]: { description: "Success", ...(response ? { content: { [contentType]: { schema: typeof response === "string" ? ref(response) : response } } } : {}) },
      default: { description: "Validation, authorization, conflict, throttling or dependency failure", content: { "application/json": { schema: ref("Error") } } } } };
  if (auth) operation.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
  if (body) operation.requestBody = { required: true, content: { "application/json": { schema: typeof body === "string" ? ref(body) : body } } };
  (paths[path] ||= {})[method] = operation;
}
add("/health", "get", "health", object({ status: str }));
add("/ready", "get", "readiness", object({ status: str, database: bool, redis: str }));
paths["/ready"].get.responses[503] = { ...paths["/ready"].get.responses[200], description: "Database not ready" };
add("/api/auth/config", "get", "authConfig", object({ googleClientId: nullable(str) }));
add("/api/auth/register", "post", "register", "Auth", { body: "RegisterRequest", status: 201 });
add("/api/auth/login", "post", "login", "Auth", { body: "LoginRequest" });
add("/api/auth/google", "post", "googleLogin", "Auth", { body: object({ credential: str }) });
add("/api/auth/logout", "post", "logout", "Message");
add("/api/auth/me", "get", "profile", "Profile", { auth: true });
add("/api/auth/overview", "get", "founderOverview", "FounderOverview", { auth: true });
add("/api/auth/profile", "patch", "updateProfile", "Profile", { auth: true, body: "ProfileRequest" });
add("/api/auth/password", "patch", "changePassword", "Message", { auth: true, body: "PasswordRequest" });
add("/api/auth/forgot-password", "post", "forgotPassword", "Message", { body: "EmailRequest" });
add("/api/auth/reset-password", "post", "resetPassword", "Message", { body: "ResetRequest" });
add("/api/waitlists", "post", "createCampaign", "CampaignResponse", { auth: true, body: "CampaignCreateRequest", status: 201 });
add("/api/waitlists", "get", "campaigns", "CampaignList", { auth: true });
add("/api/waitlists/design", "post", "generateDesign", object({ design: ref("DesignDraft") }), { auth: true, body: "GenerateDesignRequest" });
add("/api/waitlists/{id}", "get", "campaign", "CampaignResponse", { auth: true });
add("/api/waitlists/{id}", "patch", "updateCampaign", "CampaignResponse", { auth: true, body: "CampaignUpdateRequest" });
add("/api/waitlists/{id}/stats", "get", "campaignStats", "Stats", { auth: true, query: { page: { ...int, minimum: 1, maximum: 1000000, default: 1 }, limit: { ...int, minimum: 1, maximum: 100, default: 50 } } });
add("/api/waitlists/{id}/funnel", "get", "campaignFunnel", "Funnel", { auth: true, query: { days: { ...int, minimum: 1, maximum: 365 } } });
add("/api/waitlists/{id}/export", "get", "exportSubscribers", str, { auth: true, contentType: "text/csv" });
add("/api/waitlists/{id}/signups/{signupId}/position", "patch", "updatePosition", object({ signup: ref("Subscriber") }), { auth: true, body: "PositionRequest" });
add("/api/waitlists/{id}/signups/batch-invite", "post", "inviteSubscribers", "BatchInvitation", { auth: true, body: "InviteRequest" });
add("/api/w/{slug}", "get", "publicCampaign", "PublicCampaign");
add("/api/w/{slug}/signup", "post", "joinCampaign", "StatusLink", { body: "JoinRequest", status: 202 });
add("/api/w/{slug}/status-link", "post", "requestStatusLink", "StatusLink", { body: "EmailRequest", status: 202 });
add("/api/w/{slug}/verify", "post", "verifySubscriber", "SubscriberStatus", { body: "VerifyRequest" });
add("/api/w/{slug}/position", "get", "subscriberPosition", "SubscriberStatus", { headers: [{ in: "header", name: "X-Subscriber-Token", required: true, schema: str }] });
add("/api/w/{slug}/leaderboard", "get", "referrerLeaderboard", "PublicLeaderboard");
add("/api/w/{slug}/activity", "get", "recentActivity", "Activity");
add("/api/w/{slug}/visit", "post", "recordVisit", object({ recorded: bool }), { body: "VisitRequest" });
add("/api/discover/leaderboard", "get", "discoverProducts", "Discovery", { query: { period: enumeration("week", "all"), limit: { ...int, minimum: 1, maximum: 24 } } });
add("/api/payments/checkout", "post", "checkout", object({ checkoutUrl: str }), { auth: true, body: object({ plan: enumeration("starter", "pro", "agency") }) });
add("/api/payments/portal", "get", "billingPortal", object({ portalUrl: str }), { auth: true });
add("/api/payments/webhook", "post", "billingWebhook", object({ received: bool }), { body: { type: "object", additionalProperties: true }, headers: [{ in: "header", name: "X-Signature", required: true, schema: str }] });
add("/api/admin/overview", "get", "adminOverview", "AdminOverview", { auth: true });
const adminQuery = { page: { ...int, minimum: 1, maximum: 100000, default: 1 }, limit: { ...int, minimum: 1, maximum: 50, default: 20 }, search: { ...str, maxLength: 100 }, founderId: id, waitlistId: id };
for (const [path, name] of [["founders", "AdminFounder"], ["campaigns", "AdminCampaign"], ["subscribers", "AdminSubscriber"]]) add(`/api/admin/${path}`, "get", `admin${name}`, object({ items: array(ref(name)), pagination: ref("AdminPagination") }), { auth: true, query: adminQuery });
add("/api/admin/campaigns/{id}/discovery", "patch", "moderateDiscovery", object({ campaign: object({ _id: id, discoveryHidden: bool }) }), { auth: true, body: object({ discoveryHidden: bool }) });
add("/api/admin/diagnostics", "get", "diagnostics", "Diagnostics", { auth: true });
const monitoringQuery = { hours: { ...int, minimum: 1, maximum: 24, default: 24 }, errorsOnly: enumeration("true", "false") };
add("/api/admin/monitoring", "get", "monitoring", "Monitoring", { auth: true, query: monitoringQuery });
add("/api/admin/traces", "get", "traces", object({ traces: array(ref("TraceSpan")), limit: int }), { auth: true, query: monitoringQuery });
add("/api/admin/traces/{traceId}", "get", "trace", object({ traceId: str, spans: array(ref("TraceSpan")), truncated: bool }), { auth: true });
add("/api/telemetry/vitals", "post", "webVitals", null, { status: 204 });
paths["/api/telemetry/vitals"].post.requestBody = { required: true, content: { "text/plain": { schema: str } } };
paths["/api/telemetry/vitals"].post.responses[403] = { description: "Untrusted or missing Origin", content: { "text/plain": { schema: str } } };
module.exports = { openapi: "3.1.0", info: { title: "LaunchQueue API", version: "1.1.0", description: "Generated from contracts/api.js and Zod request validators. Admin endpoints require current database approval. Cookie-authenticated writes require X-LaunchQueue-Request: 1 and a trusted Origin." },
  servers: [{ url: "http://localhost:5000" }, { url: "https://launchqueue-backend.onrender.com" }], paths,
  components: { securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "token" }, bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }, schemas } };
