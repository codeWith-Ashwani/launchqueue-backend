# Redis and Render deployment

The frontend stays on Vercel. The Express API stays on Render. MongoDB remains authoritative. The email worker will run as a separate Render background worker from the backend repository.

## Local testing

Use Redis 7+ or compatible Valkey with `maxmemory-policy noeviction` for BullMQ. On Ubuntu/WSL, install `redis-server`, then run a dedicated instance:

```sh
redis-server --bind 127.0.0.1 --port 6380 --save '' --appendonly no --maxmemory-policy noeviction
```

Run `npm test` in `server/`. To include real Redis integration tests, set `TEST_REDIS_URL=redis://127.0.0.1:6380`. Tests use unique keys and never flush a shared database. CI includes Redis automatically. Production persistence should be enabled; the local example is intentionally disposable.

## Render setup (provision after confirming budget)

1. Create a Key Value instance in the API's region and workspace. New instances use Valkey. For durable jobs, use persistent storage and `noeviction`.
2. Add its internal connection URL as `REDIS_URL` to the API and worker. Never put this URL into a `VITE_` variable or source control.
3. The worker needs the same MongoDB, email, JWT, and client URL configuration as the API. Configure Node 22.
4. Enable queued email only after the worker and datastore pass readiness checks. Build 5 supplies the worker command and delivery settings.

Request-side Redis connections have bounded timeouts and no offline command backlog. Worker connections retry until Redis returns. API readiness requires MongoDB; optional Redis failures are reported as degraded dependency state rather than taking all signup traffic offline. The MongoDB outbox introduced in Build 5 retains delivery work during Redis outages.

References: https://render.com/docs/background-workers · https://render.com/docs/key-value · https://docs.bullmq.io/guide/going-to-production
