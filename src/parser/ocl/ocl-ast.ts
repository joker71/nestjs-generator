/**
 * AST cho OCL subset dùng đặc tả ràng buộc RBAC (Sandhu et al. 1996;
 * Ray, Li, France 2004 — UML template + OCL constraints).
 *
 * Subset bao phủ:
 *  - context <QualifiedName> / inv <name>: <expr>
 *  - let ... in, if-then-else-endif
 *  - implies / or / xor / and / not, so sánh, số học
 *  - navigation `.` và collection op `->` (forAll, exists, closure, ...)
 *  - qualified name `Domain::Role` cho cross-domain
 *  - literal: Int, Real, String, Boolean, null, Set{...}
 */

// ---------- Vị trí (phục vụ báo lỗi/diagnostics) ----------
export interface SourceLoc {
  line: number;
  column: number;
}

// ---------- Cấu trúc file ----------
export interface OclFile {
  kind: 'OclFile';
  contexts: OclContext[];
}

export interface OclContext {
  kind: 'Context';
  /** Ví dụ ['Role'] hoặc ['Academic', 'Role'] (Academic::Role) */
  contextName: string[];
  invariants: OclInvariant[];
  loc?: SourceLoc;
}

export interface OclInvariant {
  kind: 'Invariant';
  /** Tên inv (tùy chọn trong OCL) */
  name?: string;
  body: OclExpression;
  loc?: SourceLoc;
}

// ---------- Biểu thức ----------
export type OclExpression =
  | LetExpr
  | IfExpr
  | BinaryExpr
  | UnaryExpr
  | PropertyCallExpr
  | CollectionOpExpr
  | SelfExpr
  | QualifiedRefExpr
  | LiteralExpr
  | CollectionLiteralExpr;

export interface LetExpr {
  kind: 'Let';
  bindings: LetBinding[];
  body: OclExpression; // phần sau 'in'
}

export interface LetBinding {
  name: string;
  declaredType?: OclType;
  value: OclExpression;
}

export interface IfExpr {
  kind: 'If';
  condition: OclExpression;
  thenExpr: OclExpression;
  elseExpr: OclExpression;
}

export type BinaryOp =
  | 'implies' | 'or' | 'xor' | 'and'
  | '=' | '<>' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/';

export interface BinaryExpr {
  kind: 'Binary';
  op: BinaryOp;
  left: OclExpression;
  right: OclExpression;
}

export interface UnaryExpr {
  kind: 'Unary';
  op: 'not' | '-';
  operand: OclExpression;
}

/**
 * Truy cập qua dấu chấm: `self.permissions`, `Student.allInstances()`.
 * `args === undefined` → navigation thuộc tính; `args` là mảng (kể cả rỗng) → gọi operation.
 */
export interface PropertyCallExpr {
  kind: 'PropertyCall';
  source: OclExpression;
  property: string;
  args?: OclExpression[];
}

/**
 * Collection op qua mũi tên: `x->forAll(r | ...)`, `x->size()`, `x->includes(y)`.
 * Nếu có iterator (`r |`) thì dùng `iterators` + `body`; ngược lại dùng `args`.
 */
export interface CollectionOpExpr {
  kind: 'CollectionOp';
  source: OclExpression;
  op: string;
  iterators?: IteratorVar[];
  body?: OclExpression;
  args?: OclExpression[];
}

export interface IteratorVar {
  name: string;
  declaredType?: OclType;
}

export interface SelfExpr {
  kind: 'Self';
}

/**
 * Tham chiếu tên (biến let, biến iterator, class, hoặc cross-domain `Finance::Auditor`).
 * Việc phân giải biến/kiểu để giai đoạn semantic xử lý.
 * `args` khác undefined → lời gọi hàm dạng `f(x)`.
 */
export interface QualifiedRefExpr {
  kind: 'QualifiedRef';
  parts: string[];
  args?: OclExpression[];
}

export interface LiteralExpr {
  kind: 'Literal';
  literalType: 'Integer' | 'Real' | 'String' | 'Boolean' | 'Null';
  value: number | string | boolean | null;
}

export interface CollectionLiteralExpr {
  kind: 'CollectionLiteral';
  collectionKind: 'Set' | 'Bag' | 'Sequence' | 'OrderedSet';
  elements: OclExpression[];
}

// ---------- Kiểu ----------
/** `Role`, `Academic::Role`, `Set(Role)`, `Sequence(Academic::Role)` */
export interface OclType {
  name: string[];
  elementType?: OclType;
}

// ---------- Diagnostics ----------
export interface OclDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
  column?: number;
  file?: string;
}

export interface OclParseResult {
  ast?: OclFile;
  errors: OclDiagnostic[];
}
