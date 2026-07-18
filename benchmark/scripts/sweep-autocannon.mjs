#!/usr/bin/env node
/**
 * SWEEP AUTOCANNON — quét (biến thể × endpoint × role) và ghi CSV.
 *
 *   node benchmark/scripts/sweep-autocannon.mjs \
 *     --app benchmark/build/app-generated \
 *     --targets generated=http://localhost:3001,off=http://localhost:3002,manual=http://localhost:3003,casbin=http://localhost:3004 \
 *     --roles Admin,StudentRole,NONE \
 *     --duration 15 --connections 50 --warmup 3 \
 *     --out benchmark/results/autocannon.csv
 *
 * --app chỉ dùng để trích danh sách route (mọi biến thể cùng model nên route
 * giống nhau). Yêu cầu: các server đã chạy sẵn (docker compose up).
 * Cần: npm install autocannon (có sẵn trong harness devDependencies).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
// autocannon lấy từ node_modules của app build (harness devDeps) hoặc của repo
let autocannon;
try {
  autocannon = require(path.resolve(argv('app'), 'node_modules', 'autocannon'));
} catch {
  autocannon = require('autocannon');
}
const { extractRoutes } = require(new URL('./extract-routes.js', import.meta.url).pathname);

function argv(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const appDir = path.resolve(argv('app', 'benchmark/build/app-generated'));
const targets = argv('targets', 'generated=http://localhost:3001')
  .split(',')
  .map((t) => {
    const [name, url] = t.split('=');
    return { name, url: url.replace(/\/$/, '') };
  });
const roles = argv('roles', 'Admin,NONE').split(',');
const duration = Number(argv('duration', '15'));
const warmup = Number(argv('warmup', '3'));
const connections = Number(argv('connections', '50'));
const pipelining = Number(argv('pipelining', '1'));
const outFile = path.resolve(argv('out', 'benchmark/results/autocannon.csv'));

const routes = extractRoutes(path.join(appDir, 'src'));
if (!routes.length) {
  console.error(`Không có route trong ${appDir}/src`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const header =
  'timestamp,variant,method,path,role,connections,duration_s,' +
  'rps_mean,lat_mean_ms,lat_p50_ms,lat_p97_5_ms,lat_p99_ms,non2xx,errors\n';
if (!fs.existsSync(outFile)) fs.writeFileSync(outFile, header);

function bench(url, method, role, dur) {
  const headers = { 'content-type': 'application/json' };
  if (role !== 'NONE') headers['x-roles'] = role;
  const opts = { url, method, headers, connections, pipelining, duration: dur };
  if (method === 'POST' || method === 'PUT') opts.body = '{}';
  return autocannon(opts);
}

const rows = [];
for (const target of targets) {
  for (const route of routes) {
    const url = target.url + route.path.replace(/:\w+/g, '1');
    for (const role of roles) {
      process.stdout.write(
        `▶ ${target.name} ${route.method} ${route.path} role=${role} ... `,
      );
      // warm-up ngắn, bỏ kết quả
      if (warmup > 0) await bench(url, route.method, role, warmup);
      const r = await bench(url, route.method, role, duration);
      const row = [
        new Date().toISOString(),
        target.name,
        route.method,
        route.path,
        role,
        connections,
        duration,
        r.requests.average,
        r.latency.average,
        r.latency.p50,
        r.latency.p97_5,
        r.latency.p99,
        r.non2xx,
        r.errors,
      ].join(',');
      fs.appendFileSync(outFile, row + '\n');
      rows.push({ variant: target.name, route: `${route.method} ${route.path}`, role, rps: r.requests.average, p99: r.latency.p99, non2xx: r.non2xx });
      console.log(`rps=${r.requests.average} p99=${r.latency.p99}ms non2xx=${r.non2xx}`);
    }
  }
}

console.log('\nKết quả (rps trung bình / p99 ms):');
console.table(rows);
console.log(`CSV: ${outFile}`);
