#!/usr/bin/env node
/**
 * Sinh model PlantUML TỔNG HỢP để quét tham số mô hình:
 *
 *   node benchmark/scripts/gen-synthetic-model.js --depth 8 --aggregates 5 --extra-perms 20 \
 *        --out benchmark/build/synthetic-d8.puml
 *
 * Tham số:
 *   --depth D        độ sâu chuỗi role hierarchy (Level0 ← Level1 ← ... ← Level{D})
 *   --aggregates M   số AggregateRoot (mỗi cái → 1 controller CRUD 5 endpoint)
 *   --extra-perms K  số permission "nhiễu" thêm vào role gốc (phình PA table)
 *
 * Thiết kế thí nghiệm: TOÀN BỘ permission CRUD gán cho Level0 (gốc/junior).
 * Role sâu nhất Level{D} không có permission trực tiếp — chỉ nhận qua kế thừa.
 * Load test với header x-roles: Level{D} buộc guard giải hierarchy D bước:
 *   - guard sinh tự động: expand mỗi request  → kỳ vọng tăng theo D
 *   - manual (flatten):   lookup O(1)         → kỳ vọng phẳng theo D
 *   - casbin:             matcher g() runtime  → kỳ vọng tăng theo D
 * Biểu đồ p99 theo D là kết quả chính của thí nghiệm scaling.
 *
 * Tên aggregate là từ đơn (Order, Invoice...) để khớp chính xác convention
 * VIEW_{PLURAL}/CREATE_{CONST}/... của transformer (constantCase + plural).
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const depth = Number(arg('depth', '4'));
const nAgg = Number(arg('aggregates', '3'));
const extraPerms = Number(arg('extra-perms', '0'));
const out = path.resolve(arg('out', `benchmark/build/synthetic-d${depth}.puml`));

const WORDS = [
  'Order', 'Invoice', 'Product', 'Customer', 'Payment', 'Shipment', 'Ticket',
  'Account', 'Contract', 'Voucher', 'Warehouse', 'Supplier', 'Category',
  'Discount', 'Refund', 'Basket', 'Review', 'Message', 'Report', 'Document',
];
if (nAgg > WORDS.length) {
  console.error(`--aggregates tối đa ${WORDS.length}`);
  process.exit(1);
}
const aggregates = WORDS.slice(0, nAgg);

// Nhân bản đúng convention của model-transformer.ts
const constant = (s) => s.toUpperCase();
const plural = (t) =>
  t.endsWith('Y') ? `${t.slice(0, -1)}IES` : t.endsWith('S') ? `${t}ES` : `${t}S`;
const crudPerms = (name) => {
  const u = constant(name);
  return [`VIEW_${plural(u)}`, `CREATE_${u}`, `UPDATE_${u}`, `DELETE_${u}`];
};

const lines = [];
lines.push(`@startuml Synthetic-d${depth}-a${nAgg}`);
lines.push(`package "PerfContext" <<BoundedContext>> {`);
lines.push('');

for (const name of aggregates) {
  lines.push(`  class ${name} <<AggregateRoot>> {`);
  lines.push(`    +name: String`);
  lines.push(`    +amount: Int`);
  lines.push(`    +active: Boolean`);
  lines.push(`  }`);
  lines.push('');
}

// Level0: role gốc giữ toàn bộ permission
lines.push(`  class Level0 <<Role>> {`);
for (const name of aggregates) {
  for (const p of crudPerms(name)) lines.push(`    ${p} : ${name}.access`);
}
for (let i = 0; i < extraPerms; i++) {
  lines.push(`    EXTRA_PERM_${i} : ${aggregates[0]}.extra`);
}
lines.push(`  }`);
lines.push('');

// Chuỗi hierarchy: Level{i} kế thừa Level{i-1}
for (let i = 1; i <= depth; i++) {
  lines.push(`  class Level${i} <<Role>>`);
}
lines.push('');
for (let i = 1; i <= depth; i++) {
  lines.push(`  Level${i} --|> Level${i - 1}`);
}

lines.push(`}`);
lines.push(`@enduml`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(
  `Đã sinh ${out}\n` +
    `  ${nAgg} aggregate (${nAgg * 5} endpoint), hierarchy sâu ${depth}, ` +
    `${nAgg * 4 + extraPerms} permission ở Level0\n` +
    `Role để load-test hierarchy: x-roles: Level${depth}\n` +
    `Tiếp theo: node benchmark/scripts/make-variant.js --model ${path.relative(process.cwd(), out)} --variant generated --out benchmark/build/synthetic-d${depth}-generated`,
);
