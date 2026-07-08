/**
 * CST → AST: visitor chuyển cây cú pháp Chevrotain thành AST gọn (ocl-ast.ts)
 * để transformer/generator và bộ export USE dùng.
 */
import { CstNode, IToken } from 'chevrotain';
import { oclParserInstance } from './ocl-cst-parser';
import {
  BinaryExpr,
  BinaryOp,
  IteratorVar,
  LetBinding,
  OclContext,
  OclExpression,
  OclFile,
  OclInvariant,
  OclType,
} from './ocl-ast';

const BaseVisitor = oclParserInstance.getBaseCstVisitorConstructor();

/** Gộp chuỗi binary trái-kết-hợp: lhs op1 rhs1 op2 rhs2 ... */
function foldBinary(
  visit: (node: CstNode) => OclExpression,
  lhs: CstNode,
  ops: IToken[] | undefined,
  rhss: CstNode[] | undefined,
): OclExpression {
  let result = visit(lhs);
  if (!ops || !rhss) return result;
  for (let i = 0; i < rhss.length; i++) {
    const expr: BinaryExpr = {
      kind: 'Binary',
      op: ops[i].image as BinaryOp,
      left: result,
      right: visit(rhss[i]),
    };
    result = expr;
  }
  return result;
}

/** Kết quả trung gian của một callSuffix (dot hoặc arrow) */
interface SuffixPart {
  suffixKind: 'dot' | 'arrow';
  name: string;
  hasParens?: boolean;
  args?: OclExpression[];
  iterators?: IteratorVar[];
  body?: OclExpression;
}

class OclAstBuilder extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  // ---------- Cấu trúc file ----------

  oclFile(ctx: any): OclFile {
    const contexts: OclContext[] = (ctx.contextDecl ?? []).map((n: CstNode) =>
      this.visit(n),
    );
    return { kind: 'OclFile', contexts };
  }

  contextDecl(ctx: any): OclContext {
    const nameParts: string[] = this.visit(ctx.contextName[0]);
    const firstTok: IToken = ctx.Context[0];
    return {
      kind: 'Context',
      contextName: nameParts,
      invariants: (ctx.invariant ?? []).map((n: CstNode) => this.visit(n)),
      loc: { line: firstTok.startLine ?? 0, column: firstTok.startColumn ?? 0 },
    };
  }

  invariant(ctx: any): OclInvariant {
    const invTok: IToken = ctx.Inv[0];
    return {
      kind: 'Invariant',
      name: ctx.invName?.[0]?.image,
      body: this.visit(ctx.body[0]),
      loc: { line: invTok.startLine ?? 0, column: invTok.startColumn ?? 0 },
    };
  }

  // ---------- Biểu thức ----------

  expression(ctx: any): OclExpression {
    if (ctx.letExpr) return this.visit(ctx.letExpr[0]);
    return this.visit(ctx.impliesExpr[0]);
  }

  letExpr(ctx: any): OclExpression {
    const bindings: LetBinding[] = ctx.letBinding.map((n: CstNode) =>
      this.visit(n),
    );
    return { kind: 'Let', bindings, body: this.visit(ctx.body[0]) };
  }

  letBinding(ctx: any): LetBinding {
    return {
      name: ctx.varName[0].image,
      declaredType: ctx.declaredType
        ? this.visit(ctx.declaredType[0])
        : undefined,
      value: this.visit(ctx.value[0]),
    };
  }

  impliesExpr(ctx: any): OclExpression {
    // token 'implies' có image 'implies' — foldBinary dùng image làm op
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  orExpr(ctx: any): OclExpression {
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  andExpr(ctx: any): OclExpression {
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  notExpr(ctx: any): OclExpression {
    if (ctx.operand) {
      return { kind: 'Unary', op: 'not', operand: this.visit(ctx.operand[0]) };
    }
    return this.visit(ctx.comparison[0]);
  }

  comparison(ctx: any): OclExpression {
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  additive(ctx: any): OclExpression {
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  multiplicative(ctx: any): OclExpression {
    return foldBinary((n) => this.visit(n), ctx.lhs[0], ctx.op, ctx.rhs);
  }

  unary(ctx: any): OclExpression {
    if (ctx.operand) {
      return { kind: 'Unary', op: '-', operand: this.visit(ctx.operand[0]) };
    }
    return this.visit(ctx.postfix[0]);
  }

  postfix(ctx: any): OclExpression {
    let expr: OclExpression = this.visit(ctx.primary[0]);
    for (const suffixNode of ctx.callSuffix ?? []) {
      const part: SuffixPart = this.visit(suffixNode);
      if (part.suffixKind === 'dot') {
        expr = {
          kind: 'PropertyCall',
          source: expr,
          property: part.name,
          args: part.hasParens ? part.args ?? [] : undefined,
        };
      } else {
        expr = {
          kind: 'CollectionOp',
          source: expr,
          op: part.name,
          iterators: part.iterators,
          body: part.body,
          args: part.iterators ? undefined : part.args ?? [],
        };
      }
    }
    return expr;
  }

  callSuffix(ctx: any): SuffixPart {
    if (ctx.dotSuffix) return this.visit(ctx.dotSuffix[0]);
    return this.visit(ctx.arrowSuffix[0]);
  }

  dotSuffix(ctx: any): SuffixPart {
    return {
      suffixKind: 'dot',
      name: ctx.prop[0].image,
      hasParens: !!ctx.LParen,
      args: ctx.argList ? this.visit(ctx.argList[0]) : [],
    };
  }

  arrowSuffix(ctx: any): SuffixPart {
    if (ctx.iteratorBody) {
      const iter = this.visit(ctx.iteratorBody[0]);
      return {
        suffixKind: 'arrow',
        name: ctx.opName[0].image,
        iterators: iter.iterators,
        body: iter.body,
      };
    }
    return {
      suffixKind: 'arrow',
      name: ctx.opName[0].image,
      args: ctx.argList ? this.visit(ctx.argList[0]) : [],
    };
  }

  iteratorBody(ctx: any): { iterators: IteratorVar[]; body: OclExpression } {
    return {
      iterators: ctx.iteratorVar.map((n: CstNode) => this.visit(n)),
      body: this.visit(ctx.body[0]),
    };
  }

  iteratorVar(ctx: any): IteratorVar {
    return {
      name: ctx.name[0].image,
      declaredType: ctx.declaredType
        ? this.visit(ctx.declaredType[0])
        : undefined,
    };
  }

  argList(ctx: any): OclExpression[] {
    return ctx.expression.map((n: CstNode) => this.visit(n));
  }

  primary(ctx: any): OclExpression {
    if (ctx.literal) return this.visit(ctx.literal[0]);
    if (ctx.Self) return { kind: 'Self' };
    if (ctx.ifExpr) return this.visit(ctx.ifExpr[0]);
    if (ctx.paren) return this.visit(ctx.paren[0]);
    if (ctx.collectionLiteral) return this.visit(ctx.collectionLiteral[0]);
    return this.visit(ctx.nameOrCall[0]);
  }

  literal(ctx: any): OclExpression {
    if (ctx.NumberLiteral) {
      const img: string = ctx.NumberLiteral[0].image;
      const isReal = img.indexOf('.') >= 0;
      return {
        kind: 'Literal',
        literalType: isReal ? 'Real' : 'Integer',
        value: isReal ? parseFloat(img) : parseInt(img, 10),
      };
    }
    if (ctx.StringLiteral) {
      const raw: string = ctx.StringLiteral[0].image;
      return {
        kind: 'Literal',
        literalType: 'String',
        value: raw.slice(1, -1).replace(/\\(.)/g, '$1'),
      };
    }
    if (ctx.True) return { kind: 'Literal', literalType: 'Boolean', value: true };
    if (ctx.False) return { kind: 'Literal', literalType: 'Boolean', value: false };
    return { kind: 'Literal', literalType: 'Null', value: null };
  }

  ifExpr(ctx: any): OclExpression {
    return {
      kind: 'If',
      condition: this.visit(ctx.condition[0]),
      thenExpr: this.visit(ctx.thenExpr[0]),
      elseExpr: this.visit(ctx.elseExpr[0]),
    };
  }

  collectionLiteral(ctx: any): OclExpression {
    return {
      kind: 'CollectionLiteral',
      collectionKind: kindTokenToName(ctx.kind[0].image),
      elements: ctx.argList ? this.visit(ctx.argList[0]) : [],
    };
  }

  nameOrCall(ctx: any): OclExpression {
    const parts: string[] = this.visit(ctx.qualifiedName[0]);
    if (ctx.LParen) {
      return {
        kind: 'QualifiedRef',
        parts,
        args: ctx.argList ? this.visit(ctx.argList[0]) : [],
      };
    }
    return { kind: 'QualifiedRef', parts };
  }

  qualifiedName(ctx: any): string[] {
    return ctx.part.map((tok: IToken) => tok.image);
  }

  typeExpr(ctx: any): OclType {
    if (ctx.collectionKind) {
      return {
        name: [kindTokenToName(ctx.collectionKind[0].image)],
        elementType: this.visit(ctx.elementType[0]),
      };
    }
    return { name: this.visit(ctx.typeName[0]) };
  }
}

function kindTokenToName(image: string): 'Set' | 'Bag' | 'Sequence' | 'OrderedSet' {
  return image as 'Set' | 'Bag' | 'Sequence' | 'OrderedSet';
}

export const oclAstBuilder = new OclAstBuilder();
