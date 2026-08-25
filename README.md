# LaunchQueue — Backend API

[![CI](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/codeWith-Ashwani/launchqueue-backend/actions/workflows/ci.yml)
[![Stack: Node.js + Express 5](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%205%20%7C%20MongoDB-111111?style=flat-square)](https://nodejs.org)
[![API Docs: OpenAPI 3.0](https://img.shields.io/badge/API%20Docs-Swagger%20UI-green?style=flat-square)](http://localhost:5000/api/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

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
2. **Waitlist Campaign Management**: Multi-tenant waitlist creation with tier-based limits, customization of branding/milestones, RFC 4180 CSV exports, and manual subscriber queue overrides.
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
- **RFC 4180 CSV Exporter**: Custom CSV formatting with comma/quote escaping, gated behind paid founder subscription tiers.
- **Interactive OpenAPI 3.0 Documentation**: Complete API specification served via Swagger UI at `/api/docs`.

---

## Tech Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (>= 18.x) | Asynchronous JavaScript runtime |
| **Web Framework** | Express 5.x | HTTP routing, controller orchestration, and middleware pipeline |
| **Database & ODM** | MongoDB with Mongoose 9.x | Document database with schema modeling, validation, and indexing |
| **Validation** | Zod 3.x | Strict schema-based request body validation middleware |
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
- **JWT Signing**: Signs payload `{ id: founder._id }` using `JWT_SECRET` with a 7-day expiry.
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
- Never stores plaintext or reversible reset tokens in the database.
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

The queue calculation is isolated in `server/utils/calculatePosition.js`:

$$\text{Current Position} = \max\left(1, \text{Base Position} - (\text{Referral Count} \times 5)\right)$$

### Join & Attribution Lifecycle
1. **Deduplication Check**: Queries `{ waitlistId, email }`. If already present, returns the existing record (`alreadyJoined: true`) without awarding duplicate referral credit.
2. **Disposable Domain Check**: Queries `isDisposableEmail(email)` against a blacklist of ~3,000 temporary mail providers.
3. **Self-Referral Guard**: If `referredBy === subscriber.refCode`, referral attribution is rejected.
4. **Base Rank Allocation**: Calculates `basePosition = totalSignups + 1`.
5. **Referrer Promotion**:
   - Increments referrer's `referralCount` by 1.
   - Recalculates referrer's `currentPosition` using `calculatePosition(basePosition, referralCount)`.
   - Sends an asynchronous rank-up notification email (`referralEmail.js`).
6. **Welcome Email**: Sends confirmation email with queue position and unique invite link (`welcomeEmail.js`).

---

## API Routes & Reference

> Complete documentation is available via the Swagger UI at `/api/docs`.

### Public Routes (`/api/w`)
| Method | Endpoint | Description | Rate Limit |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/w/:slug` | Fetch public waitlist details and styling | 100 / 15m |
| `POST` | `/api/w/:slug/signup` | Join waitlist (accepts `email`, optional `ref`) | **5 / 15m** |
| `GET` | `/api/w/:slug/position` | Check queue rank by `?ref=CODE` or `?email=EMAIL` | 100 / 15m |
| `GET` | `/api/w/:slug/leaderboard` | Top 10 referrers with anonymized emails | 100 / 15m |
| `GET` | `/api/w/:slug/activity` | Recent 10 signups with masked emails | 100 / 15m |
| `POST` | `/api/w/:slug/visit` | Record unique visit (30-min deduplication) | 100 / 15m |

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Description | Auth Required | Rate Limit |
| :--- | :--- | :--- | :---: | :---: |
| `POST` | `/api/auth/register` | Register new founder with email & password | No | **10 / 15m** |
| `POST` | `/api/auth/login` | Authenticate founder with email & password | No | **10 / 15m** |
| `POST` | `/api/auth/google` | Authenticate founder via Google ID token | No | **10 / 15m** |
| `POST` | `/api/auth/logout` | Clear authentication cookie | No | — |
| `GET` | `/api/auth/me` | Return active founder session | **JWT** | — |
| `PATCH`| `/api/auth/profile` | Update founder name and email | **JWT** | — |
| `PATCH`| `/api/auth/password` | Change password (requires current password) | **JWT** | — |
| `POST` | `/api/auth/forgot-password`| Request password reset link | No | **10 / 15m** |
| `POST` | `/api/auth/reset-password` | Submit new password with reset token | No | **10 / 15m** |

### Founder Waitlist Management (`/api/waitlists`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/waitlists` | Create new campaign (enforces plan tier limits) | **JWT** |
| `GET` | `/api/waitlists` | List all waitlists owned by authenticated founder | **JWT** |
| `GET` | `/api/waitlists/:id` | Get configuration for a specific waitlist | **JWT** |
| `PATCH`| `/api/waitlists/:id` | Update branding, copy, features, and rewards | **JWT** |
| `GET` | `/api/waitlists/:id/stats` | Analytics: visitors, signups, conversion, chart | **JWT** |
| `GET` | `/api/waitlists/:id/funnel`| Stage conversion funnel & referral breakdown | **JWT** |
| `GET` | `/api/waitlists/:id/export`| Export subscribers to CSV (paid plans only) | **JWT** |
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
- `welcomeEmail.js`: Sent immediately upon joining, including current position and referral link.
- `referralEmail.js`: Sent to referrers when an invited friend joins, displaying their updated rank.
- `invitedEmail.js`: Sent when an admin issues a batch invite, including the founder's custom `thankYouMessage`.
- `passwordResetEmail.js`: Sent on password reset requests with a secure reset link.

*Note: In development and test environments without SMTP credentials, email sending is safely mocked to prevent execution errors.*

---

## Payment Integration (Lemon Squeezy)

- **Checkout**: Generates hosted checkout URLs using Lemon Squeezy API v1 with custom passthrough data (`founder_id`).
- **Webhook Verification**: Verifies incoming `x-signature` headers against raw request body using HMAC SHA-256:
  ```javascript
  const hmac = crypto.createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  const digest = Buffer.from(hmac.update(req.rawBody).digest("hex"), "utf8");
  const signature = Buffer.from(req.get("X-Signature") || "", "utf8");
  if (!crypto.timingSafeEqual(digest, signature)) { ... }
  ```
- **Lifecycle Events**: Handles `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, and `subscription_expired` to automatically transition founder plan tiers (`free`, `starter`, `pro`, `agency`).

---

## Analytics & Aggregation Pipeline

- **Conversion Rate**: Calculated from unique page views (`PageView` collection) and signups (`Signup` collection):
  $$\text{Conversion Rate} = \frac{\text{Total Signups}}{\max(\text{Unique Visitors}, \text{Total Signups})} \times 100$$
- **Funnel Breakdown**: `GET /api/waitlists/:id/funnel` partitions signups into Direct (`referredBy: null`) vs. Referred (`referredBy: { $ne: null }`).
- **Time-Series Signups**: MongoDB Aggregation Pipeline groups signups over the last 30 days by day (`$dateToString: { format: "%Y-%m-%d" }`).

---

## Testing & Verification

The backend test suite is written in **Jest** and **Supertest**, executing against an isolated in-memory database via **`mongodb-memory-server`**.

```bash
# Run all backend integration test suites
npm test

# Run linter
npm run lint
```

### Test Suites (14 Suites, 68 Tests)
- `adminControls.test.js`: Position override validation, unowned resource 404 guards, batch invite execution.
- `auth.test.js`: Registration, login, duplicate email rejection, session verification.
- `calculatePosition.test.js`: Unit tests for mathematical referral queue promotion formula.
- `docs.test.js`: OpenAPI documentation route verification.
- `export.test.js`: CSV formatting, RFC 4180 escaping, plan-gating, unowned waitlist security.
- `funnel.test.js`: Conversion funnel metrics, zero-traffic edge cases, divide-by-zero prevention.
- `generateRefCode.test.js`: Unit tests for referral code length and uniqueness.
- `googleAuth.test.js`: Google ID token verification, account linking, unverified email rejection.
- `passwordReset.test.js`: Non-enumerating token request, SHA-256 hashing, token expiry, single-use invalidation.
- `payments.test.js`: Webhook HMAC signature verification, checkout URL generation, plan updates.
- `profile.test.js`: Profile name/email updates, duplicate collision checks, password updates.
- `signup.test.js`: Public join, anti-gaming checks, disposable email blocking, referral attribution.
- `validateEnv.test.js`: Environment startup validation and soft payment warnings.
- `validation.test.js`: Zod schema validation across all endpoints.

---

## Environment Configuration

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
- Node.js >= 18.0.0
- MongoDB instance (local or MongoDB Atlas)

### Setup
```bash
# 1. Navigate to backend directory
cd server # or root of backend repo

# 2. Install dependencies
npm install

# 3. Configure environment file
cp .env.example .env

# 4. Start server in development mode (using nodemon)
npm run dev
```

The API will listen at `http://localhost:5000`. OpenAPI documentation is available at `http://localhost:5000/api/docs`.

---

## CI/CD Pipeline

Both frontend and backend include automated GitHub Actions workflows (`.github/workflows/ci.yml`) that execute on every push and pull request:
1. Sets up Node.js 18.x and 20.x test matrix.
2. Caches `npm` dependencies.
3. Executes ESLint (`npm run lint`).
4. Executes complete test suites (`npm test`).

---

## Known Limitations

1. **Email Queueing**: Transactional emails are dispatched inline during request execution using `Promise.allSettled`. For high-volume production deployments, offloading email delivery to a persistent message queue (e.g., BullMQ with Redis) would improve latency and retry resilience.
2. **Referral Position Reindexing**: While the current position formula computes dynamically per user ($\mathcal{O}(1)$), bulk global reindexing of all subsequent waitlist entries on each join is not performed to avoid quadratic write locks on large collections.
3. **Database Transactions**: Mongoose operations currently run as single-document operations. Full ACID multi-document transactions would provide stricter guarantees during high-concurrency referral spikes on replica set clusters.
