# Reliability and Redis builds

Branch in both repositories: `feature/reliability-and-redis`.

1. Baseline: complete and pushed. Backend: 68 tests. Frontend: 31 tests and production build. Node 22 CI runs on feature branches.
2. Referral correctness: complete. Transactional allocation and referral attribution; derived, contiguous ranks; manual moves reorder neighbours. Backend: 73 tests, including concurrency and rollback. Frontend: 32 tests and production build.
3. Subscriber privacy: complete. Public referral codes and email lookups no longer retrieve private status. Seven-day scoped status tokens and generic email recovery added. Repeat signup returns recovery instructions without private data. Backend: 78 tests. Frontend: 34 tests and production build.
4. Redis connections and worker infrastructure: pending.
5. Durable email outbox and BullMQ delivery: pending.
6. Subscriber verification before referral credit: pending.
7. Shared rate limiting and authentication hardening: pending.
8. Subscription lifecycle and entitlement enforcement: pending.
9. Pagination, indexes, streaming exports, analytics and caching: pending.
10. Browser tests, demo seed, logs, documentation and benchmarks: pending.

## Deployment prerequisite for Build 2

MongoDB must be version 5 or later and run as a replica set (MongoDB Atlas qualifies). Transactions intentionally fail on standalone MongoDB instead of partially crediting a referral. The tests use a single-node replica set. Existing sequences bootstrap from the campaign's largest base position; existing score fields are retained for compatibility. Ranks are ordered by referral score, original sequence and document ID. A referral changes priority by five points; actual places gained depend on other subscribers. Manual moves preserve this ordering through a priority offset.

Render hosts the API. Vercel hosts the frontend. A separate Render worker and Redis-compatible datastore will be configured before queue delivery is enabled. Provisioning paid services requires a confirmed hosting budget.
