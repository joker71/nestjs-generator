
import { OclLexer } from './ocl-tokens';
import { oclParserInstance } from './ocl-cst-parser';
import { oclAstBuilder } from './ocl-ast-builder';
import {
  CollectionOpExpr,
  OclDiagnostic,
  OclExpression,
  OclFile,
  OclParseResult,
} from './ocl-ast';

export * from './ocl-ast';
export { OclLexer } from './ocl-tokens';
export { OclCstParser, oclParserInstance } from './ocl-cst-parser';

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parseOcl(source: string, fileName = '<ocl>'): OclParseResult {
  const errors: OclDiagnostic[] = [];

  const lexResult = OclLexer.tokenize(source);
  for (const e of lexResult.errors) {
    errors.push({
      severity: 'error',
      message: `Lỗi lexer: ${e.message}`,
      line: e.line,
      column: e.column,
      file: fileName,
    });
  }

  oclParserInstance.input = lexResult.tokens;
  const cst = oclParserInstance.oclFile();

  for (const e of oclParserInstance.errors) {
    errors.push({
      severity: 'error',
      message: `Lỗi cú pháp: ${e.message}`,
      line: e.token?.startLine ?? undefined,
      column: e.token?.startColumn ?? undefined,
      file: fileName,
    });
  }

  if (errors.length > 0) {
    return { ast: undefined, errors };
  }

  const ast = oclAstBuilder.visit(cst) as OclFile;
  return { ast, errors };
}

// ---------------------------------------------------------------------------
// Validation ngữ nghĩa nhẹ cho RBAC
// ---------------------------------------------------------------------------

/** Iterator op chuẩn OCL mà subset hỗ trợ (bắt buộc có `x | ...`) */
export const OCL_ITERATOR_OPS: ReadonlySet<string> = new Set([
  'forAll', 'exists', 'select', 'reject', 'collect',
  'closure', 'any', 'one', 'isUnique', 'sortedBy',
]);

/** Collection op không iterator */
export const OCL_COLLECTION_OPS: ReadonlySet<string> = new Set([
  'size', 'isEmpty', 'notEmpty', 'sum', 'count',
  'includes', 'excludes', 'includesAll', 'excludesAll',
  'including', 'excluding',
  'union', 'intersection', 'symmetricDifference',
  'asSet', 'asBag', 'asSequence', 'asOrderedSet',
  'flatten', 'first', 'last', 'at', 'indexOf',
]);


export const RBAC_CORE_CONTEXTS: ReadonlySet<string> = new Set([
  'Role', 'User', 'Permission', 'Session',
  'SSDRole', 'DSDRole', 'RoleMapping', 'CrossDomainSSD', 'Domain',
]);

export interface RbacValidationOptions {
 
  knownContexts?: string[];
}


export function validateRbacOcl(
  ast: OclFile,
  options: RbacValidationOptions = {},
): OclDiagnostic[] {
  const diags: OclDiagnostic[] = [];
  const known = new Set<string>(RBAC_CORE_CONTEXTS);
  for (const c of options.knownContexts ?? []) known.add(c);

  for (const context of ast.contexts) {
    const simpleName = context.contextName[context.contextName.length - 1];
    if (!known.has(simpleName)) {
      diags.push({
        severity: 'warning',
        message:
          `Context '${context.contextName.join('::')}' không thuộc metamodel RBAC ` +
          `và không có trong danh sách domain class đã khai báo.`,
        line: context.loc?.line,
        column: context.loc?.column,
      });
    }
    for (const inv of context.invariants) {
      walkExpression(inv.body, (expr) => {
        if (expr.kind !== 'CollectionOp') return;
        checkCollectionOp(expr, inv.name, diags);
      });
    }
  }
  return diags;
}

function checkCollectionOp(
  expr: CollectionOpExpr,
  invName: string | undefined,
  diags: OclDiagnostic[],
): void {
  const where = invName ? ` (inv ${invName})` : '';
  const isIterator = OCL_ITERATOR_OPS.has(expr.op);
  const isPlain = OCL_COLLECTION_OPS.has(expr.op);

  if (!isIterator && !isPlain) {
    diags.push({
      severity: 'error',
      message: `Collection op '->${expr.op}' không thuộc OCL subset hỗ trợ${where}.`,
    });
    return;
  }
  if (expr.iterators && !isIterator) {
    diags.push({
      severity: 'error',
      message: `'->${expr.op}' không nhận iterator ('x | ...')${where}.`,
    });
  }
  // isUnique chấp nhận cả hai dạng: isUnique(id) và isUnique(e | e.id)
  if (!expr.iterators && isIterator && expr.op !== 'isUnique') {
    if (!expr.args || expr.args.length !== 1) {
      diags.push({
        severity: 'error',
        message: `'->${expr.op}' cần iterator ('x | ...') hoặc đúng một biểu thức${where}.`,
      });
    }
  }
}

/** Duyệt đệ quy toàn bộ cây biểu thức */
export function walkExpression(
  expr: OclExpression,
  visit: (e: OclExpression) => void,
): void {
  visit(expr);
  switch (expr.kind) {
    case 'Let':
      for (const b of expr.bindings) walkExpression(b.value, visit);
      walkExpression(expr.body, visit);
      break;
    case 'If':
      walkExpression(expr.condition, visit);
      walkExpression(expr.thenExpr, visit);
      walkExpression(expr.elseExpr, visit);
      break;
    case 'Binary':
      walkExpression(expr.left, visit);
      walkExpression(expr.right, visit);
      break;
    case 'Unary':
      walkExpression(expr.operand, visit);
      break;
    case 'PropertyCall':
      walkExpression(expr.source, visit);
      for (const a of expr.args ?? []) walkExpression(a, visit);
      break;
    case 'CollectionOp':
      walkExpression(expr.source, visit);
      if (expr.body) walkExpression(expr.body, visit);
      for (const a of expr.args ?? []) walkExpression(a, visit);
      break;
    case 'QualifiedRef':
      for (const a of expr.args ?? []) walkExpression(a, visit);
      break;
    case 'CollectionLiteral':
      for (const e of expr.elements) walkExpression(e, visit);
      break;
    default:
      break; // Self, Literal: lá
  }
}
