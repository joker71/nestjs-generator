/**
 * Demo/smoke-test: npx ts-node src/parser/ocl/demo.ts
 * Parse examples/CourseManagementRbac.ocl + vài biểu thức biên.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseOcl, validateRbacOcl } from './index';

function check(label: string, source: string, knownContexts?: string[]): boolean {
  const { ast, errors } = parseOcl(source, label);
  if (errors.length > 0) {
    console.error(`✗ ${label}`);
    for (const e of errors) {
      console.error(`    [${e.line}:${e.column}] ${e.message}`);
    }
    return false;
  }
  const diags = validateRbacOcl(ast!, { knownContexts });
  const summary = ast!.contexts
    .map(
      (c) =>
        `${c.contextName.join('::')}{${c.invariants
          .map((i) => i.name ?? '<anon>')
          .join(', ')}}`,
    )
    .join(' ');
  console.log(`✓ ${label}: ${summary || '(rỗng)'}`);
  for (const d of diags) {
    console.log(`    ${d.severity}: ${d.message}`);
  }
  return true;
}

let ok = true;

// 1. File RBAC mẫu đầy đủ
const examplePath = path.join(__dirname, '..', '..', '..', 'examples', 'CourseManagementRbac.ocl');
const realPath = fs.existsSync(examplePath)
  ? examplePath
  : path.join(process.cwd(), 'examples', 'CourseManagementRbac.ocl');
ok = check('CourseManagementRbac.ocl', fs.readFileSync(realPath, 'utf8')) && ok;

// 2. Các trường hợp biên của grammar
ok = check('iterator-nhiều-biến', `
context SSDRole
  inv X: Set{1, 2, 3}->forAll(p, q | p <> q implies p + q > 0)
`) && ok;

ok = check('iterator-có-kiểu', `
context Role
  inv X: self.juniors->forAll(r : Academic::Role | r.name <> self.name)
`) && ok;

ok = check('let-nhiều-binding-if-then-else', `
context Role
  inv X:
    let a : Set(Role) = self.juniors->asSet(),
        b = a->size()
    in if b > 0 then a->excludes(self) else true endif
`) && ok;

ok = check('so-sánh-số-học-not-lồng', `
context Role
  inv X: not not (1 + 2 * 3 - -4 / 2 >= 0) and self.x <> null xor false
`) && ok;

ok = check('isUnique-hai-dạng', `
context Role
  inv A: Role.allInstances()->isUnique(name)
  inv B: Role.allInstances()->isUnique(r | r.name)
`) && ok;

// 3. Lỗi phải được bắt
{
  const { errors } = parseOcl(`context Role inv X: self.->size()`, 'lỗi-cú-pháp');
  console.log(
    errors.length > 0 ? '✓ bắt được lỗi cú pháp' : '✗ KHÔNG bắt được lỗi cú pháp',
  );
  if (errors.length === 0) ok = false;
}
{
  const { ast } = parseOcl(
    `context Role\n  inv X: self.roles->frobnicate(r | r)`,
    'op-lạ',
  );
  const diags = ast ? validateRbacOcl(ast) : [];
  const caught = diags.some((d) => d.message.indexOf('frobnicate') >= 0);
  console.log(caught ? '✓ bắt được op ngoài subset' : '✗ KHÔNG bắt được op lạ');
  if (!caught) ok = false;
}

console.log(ok ? '\nTẤT CẢ PASS' : '\nCÓ LỖI');
process.exit(ok ? 0 : 1);
