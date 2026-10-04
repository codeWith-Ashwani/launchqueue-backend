import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const rows = new Trend('returned_rows');
const bytes = new Trend('response_bytes');
const target = __ENV.PERFORMANCE_URL;
// This suite is only for the ephemeral fixture owned by run.js.
if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/waitlists\/[a-f\d]{24}\/stats\?limit=50$/.test(target)) {
  throw new Error('Performance tests require the isolated loopback fixture');
}
export const options = {
  scenarios: { analytics: { executor: 'shared-iterations', vus: Number(__ENV.PERFORMANCE_VUS), iterations: Number(__ENV.PERFORMANCE_ITERATIONS), maxDuration: '2m' } },
  summaryTrendStats: ['min', 'med', 'max', 'p(50)', 'p(95)'],
  systemTags: ['method', 'status', 'name', 'scenario', 'check'],
  thresholds: { http_req_duration: [`p(95)<${__ENV.PERFORMANCE_P95_MS}`], http_req_failed: ['rate==0'], checks: ['rate==1'] },
};
export default function () {
  const response = http.get(target, { headers: { Authorization: `Bearer ${__ENV.PERFORMANCE_TOKEN}` }, tags: { name: 'GET analytics stats' }, timeout: '30s' });
  let body;
  try { body = response.json(); } catch { /* Count malformed responses as failures. */ }
  const signups = body?.signups;
  check(response, {
    'HTTP 200': (r) => r.status === 200,
    '50 rows with the expected total': () => signups?.length === 50 && body?.pagination?.total === Number(__ENV.PERFORMANCE_RECORDS),
    'contiguous queue positions': () => signups?.every((row, i) => row?.currentPosition === i + 1),
  });
  if (signups) rows.add(signups.length);
  bytes.add(response.body ? encodeURIComponent(response.body).replace(/%[a-f\d]{2}/gi, 'x').length : 0);
}
export function handleSummary(data) { return { [__ENV.PERFORMANCE_OUTPUT]: JSON.stringify(data, null, 2) }; }
