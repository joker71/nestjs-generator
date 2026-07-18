#!/usr/bin/env node
/**
 * Sinh main.ts + app.module.ts + auth-stub.middleware.ts vào <appSrcDir>.
 * app.module tự phát hiện các bounded-context module theo pattern
 * <name>-context/<name>-context.module.ts của generator.
 *
 * Auth stub: đọc header `x-roles` (danh sách tên role, phân cách phẩy) và gán
 * req.user = { roles } — đúng contract mà RbacGuard kỳ vọng từ JWT strategy.
 * Dùng header thay JWT để cô lập chi phí RBAC khỏi chi phí verify chữ ký;
 * muốn đo kèm JWT thật thì thay middleware này bằng @nestjs/jwt.
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(process.argv[2] ?? 'src');

const pascal = (s) =>
  s.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

// Phát hiện module theo convention của code-generator
const contextDirs = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcDir, e.name, `${e.name}.module.ts`)))
  .map((e) => e.name);

if (contextDirs.length === 0) {
  console.error(`Không tìm thấy *-context module nào trong ${srcDir}`);
  process.exit(1);
}

const imports = contextDirs
  .map((d) => `import { ${pascal(d)}Module } from './${d}/${d}.module';`)
  .join('\n');
const moduleList = contextDirs.map((d) => `${pascal(d)}Module`).join(', ');

fs.writeFileSync(
  path.join(srcDir, 'app.module.ts'),
  `/** Sinh bởi gen-app-bootstrap.js — đừng sửa tay */
import { Module } from '@nestjs/common';
${imports}

@Module({
  imports: [${moduleList}],
})
export class AppModule {}
`,
);

fs.writeFileSync(
  path.join(srcDir, 'auth-stub.middleware.ts'),
  `/** Auth stub cho benchmark: x-roles: "Admin,StudentRole" → req.user.roles */
export function rolesHeaderMiddleware(req: any, _res: any, next: () => void) {
  const h = req.headers['x-roles'];
  if (typeof h === 'string' && h.length > 0) {
    req.user = { roles: h.split(',').map((s: string) => s.trim()) };
  }
  next();
}
`,
);

fs.writeFileSync(
  path.join(srcDir, 'main.ts'),
  `/** Sinh bởi gen-app-bootstrap.js — đừng sửa tay */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { rolesHeaderMiddleware } from './auth-stub.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.use(rolesHeaderMiddleware);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log('listening on ' + (process.env.PORT ?? 3000));
}
bootstrap();
`,
);

console.log(`Bootstrap OK (${contextDirs.length} module: ${contextDirs.join(', ')})`);
