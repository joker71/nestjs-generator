#!/usr/bin/env node
/**
 * Dựng một biến thể app benchmark từ model PlantUML:
 *
 *   node benchmark/scripts/make-variant.js --model examples/course-management.puml --variant generated
 *
 * Biến thể (--variant):
 *   generated  guard sinh bởi ddd-codegen (expand hierarchy mỗi request) — phương pháp của luận văn
 *   manual     guard "viết tay": flatten hierarchy một lần lúc khởi động
 *   casbin     guard dùng node-casbin (baseline công nghiệp)
 *   pass       guard rỗng luôn cho qua (chi phí sàn của cơ chế guard)
 *   off        gỡ hẳn @UseGuards/@RequirePermissions khỏi controller (không còn RBAC)
 *
 * Kết quả: benchmark/build/app-<variant>/ gồm src/ (code sinh + bootstrap) +
 * package.json/tsconfig từ harness — build được cả bằng npm lẫn Docker.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BENCH = path.join(ROOT, 'benchmark');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const model = arg('model', 'examples/course-management.puml');
const variant = arg('variant', 'generated');
const out = path.resolve(ROOT, arg('out', path.join('benchmark', 'build', `app-${variant}`)));
const srcDir = path.join(out, 'src');

const VALID = ['generated', 'manual', 'casbin', 'pass', 'off'];
if (!VALID.includes(variant)) {
  console.error(`--variant phải là một trong: ${VALID.join(', ')}`);
  process.exit(1);
}

// ─── 1. Sinh code từ model ───────────────────────────────────────────────────
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(srcDir, { recursive: true });
console.log(`[1/4] ddd-codegen generate: ${model} → ${path.relative(ROOT, srcDir)}`);
execFileSync('npx', ['ts-node', 'src/cli.ts', 'generate', '-i', model, '-o', srcDir], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// ─── 2. Bootstrap wrapper (main.ts, app.module.ts, auth stub) ────────────────
console.log('[2/4] Sinh bootstrap wrapper');
execFileSync(process.execPath, [path.join(BENCH, 'scripts', 'gen-app-bootstrap.js'), srcDir], {
  stdio: 'inherit',
});

// ─── 3. Áp biến thể guard ────────────────────────────────────────────────────
console.log(`[3/4] Áp biến thể: ${variant}`);
const guardPath = path.join(srcDir, 'auth', 'guards', 'rbac.guard.ts');
if (variant === 'manual' || variant === 'casbin' || variant === 'pass') {
  fs.copyFileSync(path.join(BENCH, 'variants', `${variant}.guard.ts`), guardPath);
} else if (variant === 'off') {
  // Gỡ decorator RBAC khỏi mọi controller — không còn guard nào chạy
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  for (const f of walk(srcDir).filter((f) => f.endsWith('.controller.ts'))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const kept = lines.filter(
      (l) => !/^\s*@UseGuards\(RbacGuard\)/.test(l) && !/^\s*@RequirePermissions\(/.test(l),
    );
    fs.writeFileSync(f, kept.join('\n'));
  }
}

// ─── 4. Chép cấu hình harness ────────────────────────────────────────────────
console.log('[4/4] Chép package.json / tsconfig / jest config');
for (const f of ['package.json', 'tsconfig.json', 'jest-e2e.json']) {
  fs.copyFileSync(path.join(BENCH, 'harness', f), path.join(out, f));
}

console.log(`
Xong: ${path.relative(ROOT, out)}
Chạy local:
  cd ${path.relative(ROOT, out)}
  npm install && npm run build && PORT=3000 npm start
Hoặc Docker (từ thư mục benchmark/):
  docker compose up --build app-${variant}
`);
