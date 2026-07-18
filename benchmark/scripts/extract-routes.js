#!/usr/bin/env node
/**
 * Trích danh sách route + permission yêu cầu từ controller đã sinh.
 * Nguồn sự thật là CODE SINH RA (không phải model) — nhờ vậy conformance test
 * kiểm chứng đúng những gì generator thực sự phát ra.
 *
 * Dùng như thư viện: const { extractRoutes } = require('./extract-routes');
 * Dùng CLI:          node extract-routes.js <appSrcDir>   → in JSON
 */
const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

/**
 * @returns {{ method: string, path: string, permissions: string[], controller: string }[]}
 */
function extractRoutes(appSrcDir) {
  const routes = [];
  const files = walk(appSrcDir).filter((f) => f.endsWith('.controller.ts'));

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const ctrlMatch = text.match(/@Controller\('([^']*)'\)/);
    if (!ctrlMatch) continue;
    const base = '/' + ctrlMatch[1].replace(/^\/+|\/+$/g, '');

    // Quét từng dòng: gom decorator cho tới khi gặp khai báo method
    let pending = null; // { method, sub, permissions }
    for (const line of text.split('\n')) {
      const http = line.match(/^\s*@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/);
      if (http) {
        pending = { method: http[1].toUpperCase(), sub: http[2] ?? '', permissions: [] };
        continue;
      }
      if (!pending) continue;
      const perm = line.match(/^\s*@RequirePermissions\(([^)]*)\)/);
      if (perm) {
        pending.permissions.push(
          ...perm[1]
            .split(',')
            .map((s) => s.trim().replace(/^Permission\./, ''))
            .filter(Boolean),
        );
        continue;
      }
      if (/^\s*(async\s+)?\w+\s*\(/.test(line)) {
        routes.push({
          method: pending.method,
          path: pending.sub ? `${base}/${pending.sub}` : base,
          permissions: pending.permissions,
          controller: path.basename(file),
        });
        pending = null;
      }
    }
  }
  return routes;
}

module.exports = { extractRoutes };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] ?? 'src');
  console.log(JSON.stringify(extractRoutes(dir), null, 2));
}
