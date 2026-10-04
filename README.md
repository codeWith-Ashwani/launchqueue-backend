# LaunchQueue — Backend API

[![CI](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-111111)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose_9-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com)

LaunchQueue helps founders create branded prelaunch pages, grow referral waitlists, and manage their early communities. This repository contains the API for campaign design, subscriber verification, referral ranking, analytics, billing, and platform administration.

[Live application](https://launchqueue-omega.vercel.app/) · [Frontend repository](https://github.com/codeWith-Ashwani/launchqueue) · [API documentation](https://launchqueue-backend.onrender.com/api/docs)

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Backend architecture](#backend-architecture)
- [Core data models](#core-data-models)
- [Referral workflow](#referral-workflow)
- [API reference](#api-reference)
- [Local development](#local-development)
- [Environment configuration](#environment-configuration)
- [Admin access](#admin-access)
- [Subscription plans](#subscription-plans)
- [Testing and CI](#testing-and-ci)
- [Deployment](#deployment)
- [Author](#author)

## Features

- **Campaign management:** Founder-owned campaigns with editable branding, layouts, sections, images, signup copy, referral milestones, and pause/resume controls.
- **Groq page designer:** Converts product details and founder preferences into a structured design draft. Zod validates generated content before it can be saved, and founders can preview and edit the draft.
- **Product discovery:** Public weekly and all-time product rankings based on confirmed memberships. Founders explicitly opt campaigns into discovery; administrators can moderate listings.
- **Founder accounts:** Email/password and Google sign-in, editable profiles, campaign usage, subscription status, password resets, and session revocation.
- **Verified referral waitlists:** Email verification, campaign-scoped private status links, transactional referral credit, deterministic ranks, and duplicate-email protection.
- **Founder analytics:** Paginated subscriber lists, daily signup charts, visitor tracking, conversion summaries, queue controls, invitations, and streamed CSV exports for paid plans.
- **Platform administration:** Searchable founder, campaign, and subscriber records, platform totals, and audited discovery moderation. Access requires approval stored in MongoDB.
- **Redis infrastructure:** Shared rate-limit counters, short-lived public leaderboard caching, and BullMQ email jobs.
- **Email delivery:** Encrypted MongoDB outbox with inline or queued delivery through Nodemailer SMTP or Brevo HTTPS.
- **Subscription billing:** Lemon Squeezy checkout, signed webhooks, subscription lifecycle handling, billing portals, and server-enforced plan allowances.

## Tech stack

| Area | Technology |
| --- | --- |
| Runtime and API | Node.js 22, Express 5 |
| Database | MongoDB replica set, Mongoose 9 |
| Validation | Zod 4 |
| Authentication | JWT, HttpOnly cookies, bcrypt, Google Identity Services |
| Security | Helmet, CORS, origin checks, express-rate-limit |
| AI design | Groq structured outputs |
| Cache and jobs | Redis, ioredis, BullMQ |
| Email | Nodemailer, Brevo, encrypted outbox |
| Billing | Lemon Squeezy |
| API documentation | OpenAPI 3, Swagger UI |
| Testing | Jest, Supertest, mongodb-memory-server, Redis integration tests |

## Backend architecture

Routes delegate to controllers, with services handling ranking, entitlements, AI generation, caching, and email delivery. Middleware handles authentication, validation, origin checks, and rate limits.

```mermaid
flowchart TD
    CLIENT["Frontend / API client"] --> API["Express 5 API"]
    API --> AUTH["Authentication, validation & request protection"]
    AUTH --> ROUTES["/api/auth, /api/waitlists, /api/w, /api/discover, /api/admin, /api/payments"]
    ROUTES --> CONTROLLERS["Founder, campaign, subscriber, discovery, admin & billing controllers"]
    CONTROLLERS --> SERVICES["Ranking, entitlements, AI design, cache & email services"]
    SERVICES --> MONGO[("MongoDB / Mongoose")]
    SERVICES --> REDIS[("Redis")]
    SERVICES --> GROQ["Groq API"]
    CONTROLLERS --> BILLING["Lemon Squeezy"]
    MONGO --> OUTBOX["Encrypted email outbox"]
    OUTBOX --> WORKER["BullMQ email worker"]
    WORKER --> REDIS
    WORKER --> EMAIL["SMTP / Brevo"]
    SERVICES --> EMAIL
```

The API and worker share MongoDB and Redis. Email intentions are committed alongside business changes; delivery receipts update invitation status. Inline delivery uses the same outbox records.

## Core data models

| Model | Responsibility |
| --- | --- |
| `Founder` | Account identity, credentials, subscription state, session version, and `adminApproved` flag |
| `Waitlist` | Campaign ownership, public slug, branding, page design, discovery visibility, and queue versions |
| `Signup` | Subscriber identity, referral attribution, ranking inputs, verification, and invitation state |
| `PageView` | Deduplicated campaign visits for analytics |
| `EmailOutbox` | Encrypted notification payloads, retries, and delivery receipts |
| `BillingEvent` | Webhook deduplication and subscription event processing |
| `AIGenerationUsage` | Daily AI generation allowances |
| `AdminAudit` | Administrator discovery moderation history |
| `MonitoringBatch` | Bounded metric summaries with retry-safe IDs and seven day expiry |
| `TraceSpan` | Sampled request and operation spans with seven day expiry |

Unique indexes enforce one email per campaign and unique public slugs and referral codes. Campaign indexes support ownership queries, analytics, and discovery.

## Referral workflow

1. A visitor joins a campaign, optionally through a referral link.
2. The API validates the request and atomically allocates a signup sequence, creates a pending subscriber, and records a verification email.
3. Mailbox verification activates the subscriber and awards referral credit exactly once.
4. The ranking service orders eligible subscribers by `basePosition - referralCount * 5 + priorityOffset`, with sequence and document ID resolving ties, then assigns contiguous positions.
5. Campaign-scoped tokens provide private status access; recovery links are delivered by email.
6. Founders review analytics, adjust queue positions, and send access invitations. Delivery receipts move invitations from queued to sent or failed.

Public campaign leaderboards and activity feeds mask subscriber identities. Pending joins do not receive referral credit or participate in the queue until verified.

## API reference

Interactive request and response documentation is available at [`/api/docs`](https://launchqueue-backend.onrender.com/api/docs).

Endpoint names below are relative to their base path.

| Route group | Base path | Endpoints | Access |
| --- | --- | --- | --- |
| Authentication | `/api/auth` | `register`, `login`, `google`, `logout`, `me`, `config` | Session required for `me` |
| Founder profile | `/api/auth` | `overview`, `profile`, `password` | Founder session |
| Password recovery | `/api/auth` | `forgot-password`, `reset-password` | Public, rate limited |
| Campaign management | `/api/waitlists` | Root and `:id` | Campaign owner |
| AI page design | `/api/waitlists` | `POST design` | Founder session and generation allowance |
| Analytics and export | `/api/waitlists/:id` | `stats`, `funnel`, `export` | Campaign owner; paid plan for CSV |
| Subscriber controls | `/api/waitlists/:id/signups` | `:signupId/position`, `batch-invite` | Campaign owner |
| Public campaign | `/api/w/:slug` | Root, `signup`, `verify`, `status-link`, `leaderboard`, `activity`, `visit` | Public; verification/status proofs where applicable |
| Private position | `/api/w/:slug` | `GET position` | `X-Subscriber-Token` |
| Product discovery | `/api/discover` | `GET leaderboard?period=week` or `period=all` | Public, rate limited |
| Administration | `/api/admin` | `overview`, `founders`, `campaigns`, `subscribers` | Database-approved admin |
| Discovery moderation | `/api/admin` | `PATCH campaigns/:id/discovery` | Database-approved admin, audited |
| Service monitoring | `/api/admin` | `diagnostics`, `monitoring`, `traces`, `traces/:traceId` | Database-approved admin |
| Billing | `/api/payments` | `checkout`, `portal` | Founder session |
| Billing webhook | `/api/payments` | `POST webhook` | Provider HMAC signature |
| Health | `/` | `health`, `ready` | Public |

Founder sessions use HttpOnly cookies with Bearer-token support for API clients. Cookie-based mutations require `X-LaunchQueue-Request: 1` and a trusted origin. Password changes, resets, and authenticated logout revoke earlier sessions. Request logs include request IDs and durations while excluding private payloads and tokens.

## Local development

Use Node.js 22 (at least 22.13) and a MongoDB replica set that supports transactions.

```sh
git clone https://github.com/codeWith-Ashwani/launchqueue-backend.git
cd launchqueue-backend/server
npm ci
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Configure the values described below before starting. The API runs at `http://localhost:5000`, with Swagger UI at `http://localhost:5000/api/docs`.

### Local demo

Run from the backend repository root:

```sh
cd server
npm run demo
```

The demo runs a loopback API on port 5051 with an ephemeral MongoDB replica set, 120 synthetic subscribers, and captured email. Point the frontend to `http://localhost:5051/api`.

| Demo account | Email | Password |
| --- | --- | --- |
| Founder | `demo@example.com` | `DemoPassword123!` |
| Approved admin | `admin@example.com` | `DemoAdmin123!` |

Open `/w/interview-demo` in the frontend and inspect captured messages at `http://localhost:5051/__demo/inbox`. These accounts belong only to the isolated demo; the script never connects to the production database or sends real email.

## Environment configuration

The complete configuration template is [`server/.env.example`](server/.env.example). Store server credentials in `server/.env` locally and in the hosting environment in production.

| Variables | Purpose |
| --- | --- |
| `PORT`, `NODE_ENV` | API port and runtime environment |
| `MONGO_URI` | MongoDB replica set connection |
| `JWT_SECRET` | Strong session signing secret |
| `CLIENT_URL` | Frontend origin for CORS and email links |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID; exposed as public configuration through `/api/auth/config` |
| `GROQ_API_KEY`, `GROQ_MODEL` | Backend-only Groq credentials and structured-output model; default model: `openai/gpt-oss-120b` |
| `AI_DAILY_LIMIT` | Application-wide daily AI allowance; default 20, with five generations per founder per day |
| `REDIS_URL`, `TRUST_PROXY_HOPS` | Redis connection and explicit trusted proxy hop count |
| `EMAIL_PROVIDER` | `smtp` or `brevo` |
| `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE` | SMTP delivery settings |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Brevo HTTPS credentials and verified sender |
| `EMAIL_DELIVERY_MODE`, `EMAIL_ENCRYPTION_KEY` | `inline` or `queue` delivery and stable outbox encryption key |
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` | Checkout and webhook configuration |
| `LEMONSQUEEZY_STARTER_VARIANT_ID`, `LEMONSQUEEZY_PRO_VARIANT_ID`, `LEMONSQUEEZY_AGENCY_VARIANT_ID` | Plan variants |
| `LEMONSQUEEZY_TEST_MODE` | Billing integration test mode |
| `MONITORING_ENABLED` | Persist metric summaries and sampled traces in the existing MongoDB database; enabled outside tests by default |
| `OTEL_TRACE_SAMPLE_RATE`, `OTEL_SERVICE_NAME` | Trace sampling from 0 to 1 (default 0.1) and API/worker service identity |
| `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional additional export to an OTLP/HTTP collector |

## Admin access

Admin approval is stored on the founder's database record and checked on every admin request. New accounts default to `adminApproved: false`; signup and profile forms cannot assign this field.

A trusted database operator can approve an existing account by matching its Account ID from `/profile`:

```javascript
db.founders.updateOne(
  { _id: ObjectId("YOUR_FOUNDER_ACCOUNT_ID") },
  { $set: { adminApproved: true } }
);
```

Then sign in through **Admin login** in the landing page footer or `/admin/login`. Setting the flag to `false` revokes access on the next admin API request, including existing sessions.

## Subscription plans

| Plan | Campaigns | Signups per campaign | CSV export |
| --- | ---: | ---: | --- |
| Free | 1 | 500 | No |
| Starter | 3 | 5,000 | Yes |
| Pro | 10 | 25,000 | Yes |
| Agency | Unlimited | Unlimited | Yes |

Campaign creation and signup allowances are checked inside MongoDB transactions. Billing events are signature-verified, deduplicated, and ordered by provider timestamps. Subscription state determines effective access, including cancellation periods.

## Testing and CI

Run from `server/`:

```sh
npm run lint
npm run contracts:check
npm test
npm audit --omit=dev --audit-level=high
```

The backend suite contains **233 tests across 42 suites**, including Redis integrations. Tests cover authentication, database admin approval and revocation, ownership, concurrent verification and referral credit, queue ordering, private status recovery, AI draft validation, discovery moderation, analytics, exports, billing, email delivery, trace privacy, collector delivery, monitoring persistence, and API response contracts.

MongoDB tests use isolated in-memory replica sets. Set `TEST_REDIS_URL` to a test Redis instance to include BullMQ and shared rate-limit integration tests; those suites are skipped locally when it is absent. GitHub Actions provisions Redis and runs the complete suite, lint, and production dependency audit on `main`, `feature/**`, and pull requests to `main`.

The [frontend repository](https://github.com/codeWith-Ashwani/launchqueue) adds unit/component and Playwright coverage against the real isolated API. `npm run benchmark` measures paginated analytics with synthetic data.

### API contract workflow

[`server/contracts/api.js`](server/contracts/api.js) defines OpenAPI 3.1 responses and reuses Zod request validators. `npm run contracts:generate` validates the specification and generates `server/openapi.yaml`; CI rejects a stale generated file. Supertest responses are validated with Ajv, including signup's 202 response, pagination, CSV, admin authorization, and public identity boundaries. Negative tests prove that field removal, a changed field type, and public identity leakage fail validation.

After an API change, regenerate the frontend's contract snapshot and TypeScript definitions. Its CI compares the snapshot with the pinned backend commit and compiles the typed request boundary. This makes API changes reviewable across both repositories.

### Worker recovery drills

Redis integration tests fork a real BullMQ worker and kill its process before sending, after provider acceptance, and after the MongoDB delivery transaction but before the job acknowledgement. Restarting the worker must recover the outbox, preserve the delivery key, and commit the invitation receipt atomically. Tests use isolated MongoDB, a namespaced Redis queue, and a loopback provider with idempotent acceptance.

Brevo retries carry a stable outbox UUID in `headers.idempotencyKey`; its [provider deduplication window](https://developers.brevo.com/docs/heterogenous-versions-batch-emails) is bounded. SMTP receives a stable Message-ID, but SMTP acceptance followed by a process crash can cause a duplicate on retry. Delivery is at least once; the database invitation transition remains transactional.

## Performance and observability

Install [k6 2.3.0](https://github.com/grafana/k6/releases/tag/v2.3.0), then run from `server/`:

```sh
npm run performance:smoke
npm run performance:stress
npm run performance:referrals
npm run performance:matrix
```

The runner owns a temporary MongoDB replica set, enables persistent monitoring, creates synthetic subscribers and a temporary founder session, and accepts only its loopback API. The smoke test uses 1,000 subscribers, five virtual users, and 20 requests. The full matrix uses 1,000, 10,000, and 50,000 subscribers at one, five, and ten concurrent virtual users, with 50 requests per case. Every response must return 50 contiguous ranks and the correct total. Gates require p95 below `PERFORMANCE_P95_MS` (default 2,000 ms), zero request errors, and all checks passing. GitHub Actions verifies the pinned k6 binary's checksum, gates two 50,000-subscriber workloads (direct joins and credited referrals) with ten virtual users and 50 requests each, and saves measurements and query plans as an artifact.

Reports include p50/p95, throughput, response size, and correctness. Generated reports remain in ignored `docs/performance/`. These warmed, closed-workload measurements describe this fixture; use the same environment and workload when comparing changes.

A local Node 22 baseline measured p95 at **61 ms / 219 ms / 2,140 ms** for 1,000 / 10,000 / 50,000 subscribers with ten virtual users and 50 requests per case. After replacing page-wide window ranking with a bounded sort followed by page rank assignment, the corresponding measurements were **90 ms / 238 ms / 722 ms**, with persistent monitoring enabled. All nine cases passed with zero errors and correct ranks. The large case improved by about **66%**; these local measurements describe the synthetic workload, not production capacity.

The saved 50,000-row execution plans show both algorithms using the campaign index and examining the campaign's rows. The old window sort spilled to disk and sorted approximately 117 MB; the optimized page sort retained 50 rows, sorted approximately 32 KB, and avoided a disk spill. Referral scores remain computed dynamically; deeper pages retain more rows. Tests compare the page algorithm against full ranking across referrals, overrides, ties, pending members, and page boundaries. Stats share a database scan for totals, chart data, and referral credits, then reuse page ranks for overlapping referrers. Other referrer ranks use a snapshot transaction and preceding-key counts, pruning keys that cannot precede any target and avoiding a full queue window sort. A separate 50,000-member workload with ten active referrers measured 995 ms p95 at ten virtual users, with zero errors and correct ranks and credits. A concurrency test changes referral credit between candidate and count reads to verify snapshot consistency.

Database-approved admins can read `GET /api/admin/diagnostics` for route latency, operation latency, process memory, event-loop delay, anonymous Web Vitals, email state counts, and the oldest unsent email age. Counters belong to one process and reset on restart; percentiles use the most recent 128 samples per label. Labels use route templates and fixed operation names, excluding resource IDs, emails, tokens, request bodies, and raw errors.

Persistent monitoring starts automatically in the API and email worker outside tests, using the existing MongoDB connection. It batches metrics every ten seconds, bounds in-memory labels and retry batches, and uses stable batch IDs so a lost write acknowledgement cannot duplicate counts. Metrics and sampled OpenTelemetry spans expire after seven days. The admin **Service health & traces** panel reads the last hour or 24 hours and displays correlated request operations; approval is checked in MongoDB on every request.

Objectives require at least 20 observations: 99% observed HTTP availability, 95% of HTTP/operation durations within two seconds (40 seconds for AI design), and 75% of sampled Web Vitals within LCP 2.5 seconds, INP 200 ms, and CLS 0.1. Percentiles are histogram upper bounds. Browser samples can include metric updates; they are observations rather than unique visitors. Observed HTTP availability covers requests received by the API, and does not replace external uptime measurement. Status changes appear in the admin panel; this does not send external alert notifications.

Set `MONITORING_ENABLED=false` to opt out of persistent collection. For an additional collector, set `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to an OTLP/HTTP trace endpoint. Workers can use a distinct `OTEL_SERVICE_NAME`. Manual instrumentation stores route templates and fixed operation names, excluding raw URLs, payloads, emails, tokens, exception messages, and database query text. Request logs include sampled trace IDs, and `Server-Timing` exposes application response duration.

## Deployment

The frontend is hosted on Vercel and the API on Render. For the API, use `server` as the root directory, `npm ci` as the build command, and `npm start` as the start command. Configure a MongoDB replica set, the frontend `CLIENT_URL`, and the required server environment variables.

Use `EMAIL_PROVIDER=brevo` for HTTPS email delivery or configure SMTP. Inline mode runs delivery in the API process. For queued delivery, run a persistent worker with `npm run worker`, share the MongoDB, Redis, encryption, and email configuration with the API, use Redis's `noeviction` policy, and set `EMAIL_DELIVERY_MODE=queue` after the worker is connected.

`/health` reports process liveness; `/ready` reports database readiness and Redis availability. Set the Lemon Squeezy webhook to `/api/payments/webhook` and configure subscription events. Backend feature branches run CI; deployments use the configured production branch.

## Author

Built and maintained by [codeWith-Ashwani](https://github.com/codeWith-Ashwani).
