#!/usr/bin/env node
/**
 * BỘ SINH CONFORMANCE TEST — ma trận (role × endpoint) từ metamodel.
 *
 *   node benchmark/scripts/gen-conformance-tests.js --app benchmark/build/app-generated
 *
 * Sinh <app>/test/conformance.e2e-spec.ts:
 *   - route + permission yêu cầu: trích từ controller đã sinh (extract-routes)
 *   - kỳ vọng allow/deny: tính từ ROLE_PERMISSION_MAP + ROLE_HIERARCHY
 *     (import trực tiếp từ app lúc chạy test — cùng nguồn đặc tả với guard)
 *   - mỗi cặp (role, endpoint) một test case: expect 403 hoặc expect !403
 *
 * Đây là kiểm chứng RUNTIME: guard có thực thi đúng bảng PA (Sandhu RBAC₀)
 * và hierarchy (RBAC₁) như model khai báo hay không.
 * Chạy: cd <app> && npm run test:conformance
 */
const fs = require('fs');
const path = require('path');
const { extractRoutes } = require('./extract-routes');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const app = path.resolve(arg('app', 'benchmark/build/app-generated'));
const srcDir = path.join(app, 'src');
const routes = extractRoutes(srcDir);
if (routes.length === 0) {
  console.error(`Không trích được route nào từ ${srcDir}`);
  process.exit(1);
}

const spec = `/**
 * SINH TỰ ĐỘNG bởi gen-conformance-tests.js — đừng sửa tay.
 * Ma trận conformance RBAC: mỗi (role × endpoint) một test case.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { rolesHeaderMiddleware } from '../src/auth-stub.middleware';
import { Role, ROLE_HIERARCHY } from '../src/auth/rbac/roles.enum';
import { ROLE_PERMISSION_MAP } from '../src/auth/rbac/role-permission.map';

const ROUTES: { method: string; path: string; permissions: string[] }[] =
${JSON.stringify(routes.map(({ controller, ...r }) => r), null, 2)};

/** RBAC₁: permission hiệu dụng = PA(role) ∪ PA(mọi role cha theo hierarchy) */
function effectivePermissions(role: Role): Set<string> {
  const perms = new Set<string>();
  let current: Role | undefined = role;
  const seen = new Set<Role>();
  while (current && !seen.has(current)) {
    seen.add(current);
    for (const p of (ROLE_PERMISSION_MAP as any)[current] ?? []) perms.add(String(p));
    current = (ROLE_HIERARCHY as any)[current];
  }
  return perms;
}

function send(app: INestApplication, method: string, url: string, roles: string) {
  const agent = request(app.getHttpServer());
  const req = (agent as any)[method.toLowerCase()](url);
  if (roles) req.set('x-roles', roles);
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    req.set('content-type', 'application/json').send({});
  }
  return req;
}

describe('RBAC conformance matrix (role × endpoint)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(rolesHeaderMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const allRoles = Object.values(Role) as Role[];

  for (const route of ROUTES) {
    const url = route.path.replace(/:\\w+/g, '1');
    const restricted = route.permissions.length > 0;

    describe(\`\${route.method} \${route.path} [\${route.permissions.join(',') || 'public'}]\`, () => {
      for (const role of allRoles) {
        const granted =
          !restricted ||
          route.permissions.every((p) => effectivePermissions(role).has(p));

        it(\`\${role} → \${granted ? 'ALLOW' : 'DENY 403'}\`, async () => {
          const res = await send(app, route.method, url, String(role));
          if (granted) {
            expect(res.status).not.toBe(403);
            expect(res.status).toBeLessThan(500);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }

      it(\`(không role) → \${restricted ? 'DENY 403' : 'ALLOW'}\`, async () => {
        const res = await send(app, route.method, url, '');
        if (restricted) expect(res.status).toBe(403);
        else expect(res.status).toBeLessThan(500);
      });
    });
  }
});
`;

const testDir = path.join(app, 'test');
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, 'conformance.e2e-spec.ts'), spec);

const nRoles = 'đọc lúc chạy test';
console.log(
  `Đã sinh ${path.join(path.relative(process.cwd(), app), 'test', 'conformance.e2e-spec.ts')}\n` +
    `  ${routes.length} endpoint × (số role ${nRoles} + 1 anonymous) test case\n` +
    `Chạy: cd ${path.relative(process.cwd(), app)} && npm install && npm run test:conformance`,
);
