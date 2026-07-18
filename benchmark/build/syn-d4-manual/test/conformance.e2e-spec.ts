/**
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
[
  {
    "method": "GET",
    "path": "/perf-context/invoices",
    "permissions": [
      "VIEW_INVOICES"
    ]
  },
  {
    "method": "GET",
    "path": "/perf-context/invoices/:id",
    "permissions": [
      "VIEW_INVOICES"
    ]
  },
  {
    "method": "POST",
    "path": "/perf-context/invoices",
    "permissions": [
      "CREATE_INVOICE"
    ]
  },
  {
    "method": "PUT",
    "path": "/perf-context/invoices/:id",
    "permissions": [
      "UPDATE_INVOICE"
    ]
  },
  {
    "method": "DELETE",
    "path": "/perf-context/invoices/:id",
    "permissions": [
      "DELETE_INVOICE"
    ]
  },
  {
    "method": "GET",
    "path": "/perf-context/orders",
    "permissions": [
      "VIEW_ORDERS"
    ]
  },
  {
    "method": "GET",
    "path": "/perf-context/orders/:id",
    "permissions": [
      "VIEW_ORDERS"
    ]
  },
  {
    "method": "POST",
    "path": "/perf-context/orders",
    "permissions": [
      "CREATE_ORDER"
    ]
  },
  {
    "method": "PUT",
    "path": "/perf-context/orders/:id",
    "permissions": [
      "UPDATE_ORDER"
    ]
  },
  {
    "method": "DELETE",
    "path": "/perf-context/orders/:id",
    "permissions": [
      "DELETE_ORDER"
    ]
  },
  {
    "method": "GET",
    "path": "/perf-context/products",
    "permissions": [
      "VIEW_PRODUCTS"
    ]
  },
  {
    "method": "GET",
    "path": "/perf-context/products/:id",
    "permissions": [
      "VIEW_PRODUCTS"
    ]
  },
  {
    "method": "POST",
    "path": "/perf-context/products",
    "permissions": [
      "CREATE_PRODUCT"
    ]
  },
  {
    "method": "PUT",
    "path": "/perf-context/products/:id",
    "permissions": [
      "UPDATE_PRODUCT"
    ]
  },
  {
    "method": "DELETE",
    "path": "/perf-context/products/:id",
    "permissions": [
      "DELETE_PRODUCT"
    ]
  }
];

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
    const url = route.path.replace(/:\w+/g, '1');
    const restricted = route.permissions.length > 0;

    describe(`${route.method} ${route.path} [${route.permissions.join(',') || 'public'}]`, () => {
      for (const role of allRoles) {
        const granted =
          !restricted ||
          route.permissions.every((p) => effectivePermissions(role).has(p));

        it(`${role} → ${granted ? 'ALLOW' : 'DENY 403'}`, async () => {
          const res = await send(app, route.method, url, String(role));
          if (granted) {
            expect(res.status).not.toBe(403);
            expect(res.status).toBeLessThan(500);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }

      it(`(không role) → ${restricted ? 'DENY 403' : 'ALLOW'}`, async () => {
        const res = await send(app, route.method, url, '');
        if (restricted) expect(res.status).toBe(403);
        else expect(res.status).toBeLessThan(500);
      });
    });
  }
});
