# LaunchQueue — Backend API

[![CI](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml)
[![Stack: Node.js + Express 5](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%205%20%7C%20MongoDB-111111?style=flat-square)](https://nodejs.org)
[![API Docs: OpenAPI 3.0](https://img.shields.io/badge/API%20Docs-Swagger%20UI-green?style=flat-square)](http://localhost:5000/api/docs)

LaunchQueue Backend is a RESTful API service that powers the viral waitlist mechanics, subscriber queuing, referral attribution, campaign analytics, transactional emails, and subscription billing for LaunchQueue.

Built with Node.js, Express 5, and MongoDB (Mongoose 9), the service utilizes a stateless JWT architecture with `httpOnly` cookie support and strict cryptographic input verification.

---

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Backend Architecture](#backend-architecture)
- [Database Models & Schemas](#database-models--schemas)
- [Authentication & Security](#authentication--security)
- [Core Referral Engine Logic](#core-referral-engine-logic)
- [API Routes & Reference](#api-routes--reference)
- [Email & Notification Services](#email--notification-services)
- [Payment Integration (Lemon Squeezy)](#payment-integration-lemon-squeezy)
- [Analytics & Aggregation Pipeline](#analytics--aggregation-pipeline)
- [Testing & Verification](#testing--verification)
- [Environment Configuration](#environment-configuration)
- [Local Development Setup](#local-development-setup)
- [CI/CD Pipeline](#cicd-pipeline)
- [Known Limitations](#known-limitations)

---

## Overview

The LaunchQueue backend manages:
1. **Founder Operations**: Account creation, profile customization, password changes, secure password resets, and subscription tier tracking.
2. **Waitlist Campaign Management**: Multi-tenant waitlist creation (plan limits are not yet enforced), customization of branding/milestones, RFC 4180 CSV exports, and manual subscriber queue overrides.
3. **Public Referral Mechanics**: High-throughput public signup processing, anti-gaming validation (self-referrals, duplicate submissions, disposable emails), dynamic position recalculation, and anonymized leaderboards.
4. **Analytics Pipelines**: Lightweight visitor tracking (`PageView`), 30-day time-series aggregation, and conversion funnel computation (`Page Views → Signups → Referred Signups`).
5. **Billing & Webhooks**: Lemon Squeezy checkout session creation and HMAC SHA-256 verified webhook processing.

---

## Key Features

- **Stateless JWT with `httpOnly` Secure Cookies**: Secure cookie issuance with Bearer token header fallback for maximum client compatibility.
- **Google OAuth 2.0 Verification**: Server-side cryptographic token verification using `google-auth-library` with automatic local account linking.
- **Cryptographic Password Reset Flow**: SHA-256 hashed single-use reset tokens with 1-hour expiration and non-enumerating generic response handling.
- **Deterministic Referral Queue Algorithm**: Boosts referrer positions by 5 spots per valid referral while preserving base chronological sequence.
- **Anti-Gaming Protections**: Blocks self-referrals, duplicate email credit, and temporary disposable email domains.
- **Admin Subscriber Management**: Direct position overrides and bulk invitation endpoints dispatching concurrent emails via `Promise.allSettled`.
- **Conversion Funnel Analytics**: Aggregates total page views, direct vs. referred signups, and conversion rate with zero-division safety.
- **RFC 4180 CSV Exporter**: Custom CSV formatting with comma/quote escaping, available to the campaign owner; paid-plan enforcement is planned.
- **Interactive OpenAPI 3.0 Documentation**: Complete API specification served via Swagger UI at `/api/docs`.

---

## Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js 22 (>= 22.13) | Asynchronous JavaScript runtime |
| **Web Framework** | Express 5.x | HTTP routing, controller orchestration, and middleware pipeline |
| **Database & ODM** | MongoDB with Mongoose 9.x | Document database with schema modeling, validation, and indexing |
| **Validation** | Zod 4.x | Strict schema-based request body validation middleware |
| **Authentication** | JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `google-auth-library` | Token issuance, password hashing (cost factor 10), and Google ID token verification |
| **Security Middleware** | `helmet`, `cors`, `cookie-parser`, `express-rate-limit` | HTTP headers, origin whitelisting, cookie parsing, and rate limiting |
| **Email Delivery** | Nodemailer | SMTP transactional email transport with HTML template rendering |
| **API Documentation** | `swagger-ui-express`, `yamljs` | OpenAPI 3.0 UI documentation mounted at `/api/docs` |
| **Testing** | Jest, Supertest, `mongodb-memory-server` | In-memory integration and unit testing |

---

## Backend Architecture

The backend follows an MVC-inspired layered architecture separating routes, controllers, middleware, models, and utility modules.

```mermaid
flowchart TD
    subgraph Ingress ["Ingress & Middleware Layer"]
        REQ[Incoming HTTP Request] --> SEC[Helmet & CORS]
        SEC --> COOKIE[Cookie Parser & JSON Parser]
        COOKIE --> RATE[Express Rate Limiters]
        RATE --> ROUTER[Express Router /api/*]
    end

    subgraph Routes ["Route Handlers"]
        ROUTER --> R_AUTH[/api/auth]
        ROUTER --> R_WAITLIST[/api/waitlists]
        ROUTER --> R_SIGNUP[/api/w]
        ROUTER --> R_PAYMENT[/api/payments]
        ROUTER --> R_DOCS[/api/docs]
    end

    subgraph Controllers ["Controller Layer"]
        R_AUTH --> C_AUTH[authController.js]
        R_WAITLIST --> C_WAITLIST[waitlistController.js]
        R_WAITLIST --> C_DASH[dashboardController.js]
        R_SIGNUP --> C_SIGNUP[signupController.js]
        R_PAYMENT --> C_PAYMENT[paymentController.js]
    end

    subgraph Services ["Service & Utility Layer"]
        VAL[Zod Request Validation]
        POS[calculatePosition.js]
        MAIL[sendEmail.js / Nodemailer]
        GOOGLE[google-auth-library]
        HMAC[crypto HMAC SHA-256]
    end

    subgraph Database ["Data Layer (MongoDB / Mongoose)"]
        M_FOUNDER[(Founder Model)]
        M_WAITLIST[(Waitlist Model)]
        M_SIGNUP[(Signup Model)]
        M_PAGEVIEW[(PageView Model)]
    end

    C_AUTH --> VAL & GOOGLE & M_FOUNDER & MAIL
    C_WAITLIST --> VAL & M_WAITLIST & M_SIGNUP & MAIL
    C_DASH --> M_WAITLIST & M_SIGNUP & M_PAGEVIEW
    C_SIGNUP --> VAL & POS & M_WAITLIST & M_SIGNUP & M_PAGEVIEW & MAIL
    C_PAYMENT --> HMAC & M_FOUNDER
```

---

## Database Models & Schemas

### 1. `Founder` (`server/models/Founder.js`)
Represents an authenticated founder who owns waitlists.
- `name`: `String` (trimmed, default: `""`)
- `email`: `String` (required, lowercase, unique, trimmed)
- `password`: `String` (optional; `null` for Google OAuth accounts, bcrypt hashed for local accounts)
- `authProvider`: `String` (`"local"` | `"google"`, default: `"local"`)
- `googleId`: `String` (sparse unique index, optional)
- `plan`: `String` (`"free"` | `"starter"` | `"pro"` | `"agency"`, default: `"free"`)
- `lemonSqueezySubscriptionId`: `String` (default: `null`)
- `customerPortalUrl`: `String` (default: `null`)
- `resetPasswordTokenHash`: `String` (SHA-256 hash of reset token, default: `null`)
- `resetPasswordExpires`: `Date` (default: `null`)
- `timestamps`: `true` (`createdAt`, `updatedAt`)

### 2. `Waitlist` (`server/models/Waitlist.js`)
Represents a campaign waitlist configured by a founder.
- `founderId`: `ObjectId` (ref: `Founder`, required, indexed)
- `name`: `String` (required, trimmed)
- `slug`: `String` (required, lowercase, unique, trimmed)
- `description`, `heroHeadline`, `heroSubheadline`, `heroImageUrl`, `accentColor`, `ctaText`: `String`
- `thankYouMessage`: `String` (custom copy included in confirmation and invite emails)
- `features`: `[{ icon: String, title: String, description: String }]`
- `milestones`: `[{ referrals: Number, reward: String }]`
- `paused`: `Boolean` (default: `false`)
- `timestamps`: `true`

### 3. `Signup` (`server/models/Signup.js`)
Represents an individual subscriber to a waitlist.
- `waitlistId`: `ObjectId` (ref: `Waitlist`, required, indexed)
- `email`: `String` (required, lowercase, trimmed)
- `refCode`: `String` (required, unique, 8-character nanoid)
- `referredBy`: `String` (null or referrer's `refCode`, indexed)
- `basePosition`: `Number` (required; initial chronological order)
- `currentPosition`: `Number` (required; computed rank with boosts)
- `referralCount`: `Number` (default: `0`)
- `status`: `String` (`"waiting"` | `"invited"`, default: `"waiting"`)
- `timestamps`: `true`
- **Compound Index**: `{ waitlistId: 1, email: 1 }` (unique constraint prevents duplicate signups per campaign).

### 4. `PageView` (`server/models/PageView.js`)
Represents lightweight unique traffic events for conversion analytics.
- `waitlistId`: `ObjectId` (ref: `Waitlist`, required, indexed)
- `visitorId`: `String` (required, indexed)
- `timestamps`: `true`
- **Compound Index**: `{ waitlistId: 1, visitorId: 1, createdAt: -1 }` (for fast 30-minute deduplication lookup).

---

## Authentication & Security

### Token Architecture
- **JWT Signing**: Signs payload `{ id: founder._id, sessionVersion }` using `JWT_SECRET` with a 7-day expiry. Tokens include a session version checked against the founder record. Password changes, password resets, and authenticated logout revoke prior sessions. A password change refreshes the initiating browser cookie.
- **Dual Delivery**: Delivered via `httpOnly` cookie (`token`) and returned in the JSON response body.
- **Cookie Security Options**:
  ```javascript
  {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
  ```

### Password Reset Flow (Security-Hardened)
- Stores the reset token hash on the founder. Email outbox payloads containing reset links are encrypted with AES-256-GCM.
- A cryptographically random 32-byte token (`crypto.randomBytes(32).toString("hex")`) is generated.
- The SHA-256 hash of this token is stored in `resetPasswordTokenHash` alongside a 1-hour expiration date.
- The reset email link contains the unhashed raw token (`/reset-password?token=...`).
- When submitted, the server hashes the provided token and performs a single-use query match.
- Responds with an identical generic message regardless of whether the email exists to prevent user enumeration attacks.

### Google OAuth Verification
- Rather than delegating sessions to third-party middlewares, Google Identity Services ID tokens are verified cryptographically via `google-auth-library`:
  ```javascript
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  ```
- Rejects unverified emails (`email_verified: false`).
- Automatically links `googleId` to existing local-password accounts with the same email without deleting or overwriting their existing bcrypt password hash.

---

## Core Referral Engine Logic

Build 2 replaces displayed score values with contiguous ranks derived by `server/services/ranking.js`. Queue priority is `basePosition - referralCount * 5 + priorityOffset`, ordered by score, original sequence, then document ID. Signup sequence allocation and referral attribution commit in one transaction; retries cannot award the same signup twice. The legacy formula below remains only for compatibility with the stored `currentPosition` field. Manual position edits reorder neighbours through priority offsets. MongoDB 5+ running as a replica set is required. Detailed build notes stay in local, gitignored docs/.

The queue calculation is isolated in `server/utils/calculatePosition.js`:

$$\text{Current Position} = \max\left(1, \text{Base Position} - (\text{Referral Count} \times 5)\right)$$

### Join & Attribution Lifecycle
1. Reject disposable email domains and paused campaigns.
2. Allocate a monotonic sequence and create a pending subscriber with a verification email in one MongoDB transaction. Duplicate joins request a private status link instead of exposing subscriber details.
3. A 24-hour, campaign-scoped verification link proves mailbox ownership. Verification, referral credit, and confirmation notifications commit together. Repeated concurrent verification requests award the referral once. Pending records do not affect ranks or receive invitations. Existing records retain legacy access without claiming they were verified.
4. Derive contiguous ranks by score, sequence, and document ID.
4. Store confirmation and referral emails in the same transaction as the business change. A rollback also removes the notification.
5. Read private subscriber status through a signed, campaign-scoped token. Status-link recovery responds generically for known and unknown email addresses.

---

## API Routes & Reference

> Complete documentation is available via the Swagger UI at `/api/docs`.

### Public Routes (`/api/w`)

Build 3 requires `X-Subscriber-Token` for `/api/w/:slug/position`; the old email/referral query lookup is disabled. `POST /api/w/:slug/status-link` accepts an email and returns the same 202 response whether it exists or not. Recovery emails contain a seven-day private link in the URL fragment. Repeat signup returns 202 recovery instructions without subscriber data. Deploy the matching frontend update before advertising status recovery.
| Method | Endpoint | Description | Rate Limit |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/w/:slug` | Fetch public waitlist details and styling | Not currently limited |
| `POST` | `/api/w/:slug/signup` | Join waitlist (accepts `email`, optional `ref`) | **5 / 5m** |
| `GET` | `/api/w/:slug/position` | Check queue rank by `?ref=CODE` or `?email=EMAIL` | Not currently limited |
| `GET` | `/api/w/:slug/leaderboard` | Top 10 referrers with anonymized emails | Not currently limited |
| `GET` | `/api/w/:slug/activity` | Recent 8 signups with masked emails | Not currently limited |
| `POST` | `/api/w/:slug/visit` | Record unique visit (30-min deduplication) | Not currently limited |

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Description | Auth Required | Rate Limit |
| :--- | :--- | :--- | :---: | :---: |
| `POST` | `/api/auth/register` | Register new founder with email & password | No | **20 / 15m** |
| `POST` | `/api/auth/login` | Authenticate founder with email & password | No | **20 / 15m** |
| `POST` | `/api/auth/google` | Authenticate founder via Google ID token | No | **20 / 15m** |
| `POST` | `/api/auth/logout` | Clear authentication cookie | No | — |
| `GET` | `/api/auth/me` | Return active founder session | **JWT** | — |
| `PATCH`| `/api/auth/profile` | Update founder name and email | **JWT** | — |
| `PATCH`| `/api/auth/password` | Change password (requires current password) | **JWT** | — |
| `POST` | `/api/auth/forgot-password`| Request password reset link | No | **20 / 15m** |
| `POST` | `/api/auth/reset-password` | Submit new password with reset token | No | **20 / 15m** |

### Founder Waitlist Management (`/api/waitlists`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/waitlists` | Create new campaign | **JWT** |
| `GET` | `/api/waitlists` | List all waitlists owned by authenticated founder | **JWT** |
| `GET` | `/api/waitlists/:id` | Get configuration for a specific waitlist | **JWT** |
| `PATCH`| `/api/waitlists/:id` | Update branding, copy, features, and rewards | **JWT** |
| `GET` | `/api/waitlists/:id/stats` | Analytics: visitors, signups, conversion, chart | **JWT** |
| `GET` | `/api/waitlists/:id/funnel`| Stage conversion funnel & referral breakdown | **JWT** |
| `GET` | `/api/waitlists/:id/export`| Export subscribers to CSV (campaign owner) | **JWT** |
| `PATCH`| `/api/waitlists/:id/signups/:signupId/position` | Manual position override | **JWT** |
| `POST` | `/api/waitlists/:id/signups/batch-invite` | Batch invite subscribers and dispatch emails | **JWT** |

### Billing & Webhooks (`/api/payments`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/payments/checkout` | Create Lemon Squeezy hosted checkout session | **JWT** |
| `POST` | `/api/payments/webhook` | Process subscription events (HMAC verified) | **HMAC Signature** |

---

## Email & Notification Services

Transactional emails are dispatched using **Nodemailer** with modular HTML templates (`server/templates/`):
- `confirmationEmail.js`: Sent after email verification, including the current rank and referral link.
- `rankUpEmail.js`: Sent to referrers when a referred friend verifies their email, displaying their updated rank.
- `invitedEmail.js`: Sent when an admin issues a batch invite, including the founder's custom `thankYouMessage`.
- `passwordResetEmail.js`: Sent on password reset requests with a secure reset link.

Email intentions are stored in a MongoDB outbox with encrypted payloads. `EMAIL_DELIVERY_MODE=queue` keeps SMTP work outside API requests; a persistent BullMQ worker dispatches pending intentions to Redis and retries transient failures up to five times with exponential backoff. Outbox records rebuild lost Redis jobs. An invitation becomes `invited` only after a successful delivery receipt; queued and failed states appear in the dashboard, and founders can retry failed invitations.

Inline mode preserves local development compatibility and records delivery failures. Delivery is **at least once**: a process crash after SMTP accepts the email but before the MongoDB receipt can cause a duplicate. A stable Message-ID helps providers correlate retries but does not guarantee deduplication. Tests mock SMTP and exercise queue processing against a real Redis instance when `TEST_REDIS_URL` is set.

---

## Payment Integration (Lemon Squeezy)

- **Checkout**: Generates hosted checkout URLs using Lemon Squeezy API v1 with custom passthrough data (`founder_id`).
- **Webhook Verification**: Checks HMAC SHA-256 over the raw JSON body with a length-checked, timing-safe comparison. Signed payloads are validated before processing.
- **Lifecycle Events**: Processes subscription creation, updates, cancellation, resumption, expiry, pause and unpause. MongoDB receipts deduplicate retries; provider update timestamps prevent older events from overwriting newer states. Past-due and paused subscriptions retain access; unpaid and expired subscriptions lose access. Cancellation retains access until `ends_at`, enforced on reads even if an expiry webhook is delayed. Old subscription IDs and mismatched test-mode events are ignored. Portal links are refreshed from the provider because signed links expire.

---

## Analytics & Aggregation Pipeline

Subscriber roster responses are paginated (`page=1`, `limit=50`, maximum 100). Counts and daily buckets are aggregated in MongoDB; charts fill missing days across 30 UTC dates. Unique visitors are counted in MongoDB instead of loading visitor IDs into JavaScript. Traffic capture records one event per visitor per UTC half-hour bucket with a compound unique index, including concurrent requests.

`conversionRate` is the **verified signup/unique visitor ratio**, displayed with that label. It is 0 when no visitors were tracked and can exceed 100% if visitor tracking is incomplete; it is not a measured cohort conversion probability. Pending signups appear separately in stats and do not inflate the verified ratio. Date-filtered referral reports count referred enrollments during the selected period, including referrals credited to older subscribers.

CSV exports stream aggregate cursor batches with backpressure and close on disconnect. Fields beginning with spreadsheet formula characters are neutralized before RFC 4180 escaping. Campaign and date indexes support the aggregation filters.

The public leaderboard uses an optional 10-second Redis cache containing masked identities only. Cache keys include the campaign's signup sequence and queue version, so queue mutations invalidate results without scans. Cache failures fall back to MongoDB; subscriber status and founder rosters are never cached publicly.

---

## Testing & Verification

The backend test suite is written in **Jest** and **Supertest**, executing against an isolated in-memory database via **`mongodb-memory-server`**.

```bash
# Run all backend integration test suites
npm test

# Run linter
npm run lint
```

### Test Suites (28 suites, 119 tests verified in Build 9)
- `adminControls.test.js`: Position override validation, unowned resource 404 guards, batch invite execution.
- `auth.test.js`: Registration, login, duplicate email rejection, session verification.
- `calculatePosition.test.js`: Unit tests for mathematical referral queue promotion formula.
- `docs.test.js`: OpenAPI documentation route verification.
- `export.test.js`: CSV formatting, RFC 4180 escaping, and unowned waitlist security.
- `funnel.test.js`: Conversion funnel metrics, zero-traffic edge cases, divide-by-zero prevention.
- `generateRefCode.test.js`: Unit tests for referral code length and uniqueness.
- `googleAuth.test.js`: Google ID token verification, account linking, unverified email rejection.
- `passwordReset.test.js`: Non-enumerating token request, SHA-256 hashing, token expiry, single-use invalidation.
- `payments.test.js`: Missing checkout configuration, webhook HMAC signature verification, and plan updates.
- `profile.test.js`: Profile name/email updates, duplicate collision checks, password updates.
- `signup.test.js`: Public join, anti-gaming checks, disposable email blocking, referral attribution.
- `validateEnv.test.js`: Environment startup validation and soft payment warnings.
- `validation.test.js`: Zod schema validation across all endpoints.

---

## Environment Configuration

Redis infrastructure is optional: set backend-only `REDIS_URL` to a `redis://` or `rediss://` connection. `/health` reports liveness; `/ready` reports MongoDB readiness and Redis availability. Detailed deployment and build notes stay in the local, gitignored `docs/` directory.

Create a `.env` file in the `server/` root directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/launchqueue

# Authentication
JWT_SECRET=your_jwt_secret_key_minimum_32_chars
CLIENT_URL=http://localhost:5173

# Google OAuth 2.0 (Optional for Google Sign-In)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# Email / SMTP Configuration (Optional in development)
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_USER=your_smtp_username
EMAIL_PASS=your_smtp_password
EMAIL_FROM=LaunchQueue <hello@launchqueue.com>

# Lemon Squeezy Payment Gateway (Optional in development)
LEMONSQUEEZY_API_KEY=your_lemonsqueezy_api_key
LEMONSQUEEZY_STORE_ID=your_store_id
LEMONSQUEEZY_WEBHOOK_SECRET=your_webhook_secret
LEMONSQUEEZY_STARTER_VARIANT_ID=variant_starter
LEMONSQUEEZY_PRO_VARIANT_ID=variant_pro
LEMONSQUEEZY_AGENCY_VARIANT_ID=variant_agency
```

---

## Local Development Setup

### Prerequisites
- Node.js 22 >= 22.13.0 (see `.nvmrc`)
- MongoDB 5+ replica set (MongoDB Atlas supports transactions)
- Redis with `maxmemory-policy=noeviction` for queue mode

### Setup
```bash
# 1. Navigate to backend directory
cd server

# 2. Install dependencies
npm install

# 3. Configure environment file
cp ../.env.example .env

# 4. Start server in development mode (using nodemon)
npm run dev
```

The API will listen at `http://localhost:5000`. OpenAPI documentation is available at `http://localhost:5000/api/docs`.

---

## CI/CD Pipeline

Both frontend and backend include automated GitHub Actions workflows (`.github/workflows/ci.yml`) that execute on every push and pull request:
1. Sets up Node.js 22 on pushes to `main` and `feature/**`, and pull requests to `main`.
2. Caches `npm` dependencies.
3. Executes ESLint (`npm run lint`).
4. Executes complete test suites (`npm test`).

---

## Render Email Worker Setup

Keep the frontend on Vercel. The Render API and a separate persistent background worker use the same MongoDB replica set and Render Key Value instance. Set `EMAIL_DELIVERY_MODE=queue` on the API. Both processes need `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `EMAIL_ENCRYPTION_KEY`, `CLIENT_URL`, and SMTP configuration. Use a stable encryption key; changing it makes existing outbox payloads unreadable.

For the worker, set root directory `server`, build command `npm ci`, and start command `npm run worker`. Use the Redis internal URL and `noeviction` policy. Deploy and confirm the worker is connected before switching the API to queue mode. Provisioning these Render services is a separate deployment step and may require a paid plan.

## Known Limitations

- Queue delivery requires a running worker; API requests can safely persist notifications during Redis outages, but delivery waits for recovery.
- SMTP receipt means the provider accepted the message, not that it reached the subscriber's inbox.
- Referral ranks aggregate across the campaign and can use MongoDB disk spill. API responses and export application memory are bounded, but ranking still requires campaign-wide database work.
- Browser end-to-end coverage is planned in the final build.

## Shared Request Protection

When `REDIS_URL` is configured, authentication, signup, recovery, verification, status, and visitor tracking use Redis counters shared by every API instance. Atomic increment plus expiry prevents lost counter updates; IP identities are HMAC-hashed before storage. Limits have separate budgets so joining does not consume verification capacity. Redis outages return 503 on protected requests instead of allowing unbounded attempts. Without Redis, limits are local to one process.

`TRUST_PROXY_HOPS` defaults to 0. Set an explicit hop count only after checking the actual Render proxy path; never use unrestricted proxy trust. See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Unsafe requests to founder APIs reject untrusted browser origins. Cookie-based mutations also require `X-LaunchQueue-Request: 1`; the frontend Axios client adds this header. API clients using bearer tokens can continue without this browser header. The provider-signed billing webhook is exempt. Request bodies, strings, batch sizes, resource IDs, and bcrypt password byte lengths are bounded. Reset-token consumption is atomic under concurrent submissions.

## Enforced Plan Limits

| Plan | Campaigns | Signups per campaign | CSV export |
| --- | ---: | ---: | --- |
| Free | 1 | 500 | No |
| Starter | 3 | 5,000 | Yes |
| Pro | 10 | 25,000 | Yes |
| Agency | Unlimited | Unlimited | Yes |

Creation and signup limits are checked inside MongoDB transactions, including pending signups. Existing data is preserved after downgrades; capacity checks block new additions. CSV checks campaign ownership before plan access. Pricing lists implemented features only. Subscribe the provider webhook to `subscription_created` and `subscription_updated` at minimum. Set `LEMONSQUEEZY_TEST_MODE=true` only for a test-mode integration.
