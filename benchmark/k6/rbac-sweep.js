/**
 * k6 — kịch bản load test một endpoint với role cho trước.
 *
 * Chạy bằng Docker (không cần cài k6):
 *   docker compose run --rm \
 *     -e BASE_URL=http://app-generated:3000 \
 *     -e ENDPOINT=/enrollment-context/students \
 *     -e METHOD=GET -e ROLES=Admin -e P95_MS=50 \
 *     k6
 *
 * Hoặc k6 cài local:
 *   k6 run -e BASE_URL=http://localhost:3001 -e ENDPOINT=/... benchmark/k6/rbac-sweep.js \
 *     --summary-export benchmark/results/k6-generated-admin.json
 *
 * Biến môi trường:
 *   BASE_URL   http://host:port của biến thể cần đo
 *   ENDPOINT   đường dẫn (mặc định lấy GET danh sách đầu tiên)
 *   METHOD     GET|POST|PUT|DELETE (mặc định GET)
 *   ROLES      giá trị header x-roles ('' = anonymous)
 *   STAGES     JSON mảng stages (mặc định ramp 20→50→100 VU)
 *   P95_MS     ngưỡng threshold p95 (mặc định 100ms)
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const ENDPOINT = __ENV.ENDPOINT || '/';
const METHOD = (__ENV.METHOD || 'GET').toUpperCase();
const ROLES = __ENV.ROLES !== undefined ? __ENV.ROLES : 'Admin';
const EXPECT_403 = (__ENV.EXPECT_403 || 'false') === 'true';

export const options = {
  scenarios: {
    sweep: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: JSON.parse(
        __ENV.STAGES ||
          '[{"duration":"10s","target":20},{"duration":"30s","target":50},{"duration":"30s","target":100},{"duration":"10s","target":0}]',
      ),
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // ngưỡng chấp nhận — chỉnh theo máy đo; fail threshold = k6 exit code != 0
    http_req_duration: [`p(95)<${__ENV.P95_MS || 100}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const params = { headers: { 'Content-Type': 'application/json' } };
  if (ROLES) params.headers['x-roles'] = ROLES;

  const url = BASE + ENDPOINT;
  const res =
    METHOD === 'GET'
      ? http.get(url, params)
      : http.request(METHOD, url, METHOD === 'DELETE' ? null : '{}', params);

  check(res, {
    'đúng kỳ vọng RBAC': (r) => (EXPECT_403 ? r.status === 403 : r.status < 400),
  });
}
