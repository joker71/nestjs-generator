/**
 * CST parser (Chevrotain) cho OCL subset RBAC.
 *
 * Grammar (EBNF, xem thêm README.md cùng thư mục):
 *
 *   oclFile        := contextDecl* ;
 *   contextDecl    := 'context' qualifiedName invariant+ ;
 *   invariant      := 'inv' Identifier? ':' expression ;
 *   expression     := letExpr | impliesExpr ;
 *   letExpr        := 'let' letBinding (',' letBinding)* 'in' expression ;
 *   letBinding     := Identifier (':' typeExpr)? '=' expression ;
 *   impliesExpr    := orExpr ('implies' orExpr)* ;
 *   orExpr         := andExpr (('or'|'xor') andExpr)* ;
 *   andExpr        := notExpr ('and' notExpr)* ;
 *   notExpr        := 'not' notExpr | comparison ;
 *   comparison     := additive (('='|'<>'|'<'|'<='|'>'|'>=') additive)? ;
 *   additive       := multiplicative (('+'|'-') multiplicative)* ;
 *   multiplicative := unary (('*'|'/') unary)* ;
 *   unary          := '-' unary | postfix ;
 *   postfix        := primary callSuffix* ;
 *   callSuffix     := dotSuffix | arrowSuffix ;
 *   dotSuffix      := '.' Identifier ('(' argList? ')')? ;
 *   arrowSuffix    := '->' Identifier '(' (iteratorBody | argList)? ')' ;
 *   iteratorBody   := iteratorVar (',' iteratorVar)* '|' expression ;
 *   iteratorVar    := Identifier (':' typeExpr)? ;
 *   argList        := expression (',' expression)* ;
 *   primary        := literal | 'self' | ifExpr | '(' expression ')'
 *                   | collectionLiteral | nameOrCall ;
 *   ifExpr         := 'if' expression 'then' expression 'else' expression 'endif' ;
 *   collectionLiteral := ('Set'|'Bag'|'Sequence'|'OrderedSet') '{' argList? '}' ;
 *   nameOrCall     := qualifiedName ('(' argList? ')')? ;
 *   qualifiedName  := Identifier ('::' Identifier)* ;
 *   typeExpr       := ('Set'|'Bag'|'Sequence'|'OrderedSet') '(' typeExpr ')'
 *                   | qualifiedName ;
 *
 * Điểm khó duy nhất: sau `->op(` phải phân biệt iterator (`r | ...`, `p, q | ...`,
 * `r : Role | ...`) với argument thường (`includes(x)`). Giải quyết bằng custom
 * GATE quét lookahead tìm '|' (hàm isIteratorAhead), không cần backtracking.
 */
import { CstParser, IToken, TokenType } from 'chevrotain';
import * as t from './ocl-tokens';

export class OclCstParser extends CstParser {
  constructor() {
    super(t.allTokens, { maxLookahead: 3 });
    this.performSelfAnalysis();
  }

  // ---------- Lookahead gate cho iterator ----------

  /** Quét kiểu tại vị trí lookahead i; trả về vị trí sau kiểu, hoặc -1 nếu không phải kiểu */
  private skipTypeAt(i: number): number {
    const tt = this.LA(i).tokenType;
    const isCollectionKw = t.collectionKinds.indexOf(tt) >= 0;
    if (tt !== t.Identifier && !isCollectionKw) return -1;
    i += 1;
    while (this.LA(i).tokenType === t.DoubleColon) {
      i += 1;
      if (this.LA(i).tokenType !== t.Identifier) return -1;
      i += 1;
    }
    if (this.LA(i).tokenType === t.LParen) {
      i += 1;
      i = this.skipTypeAt(i);
      if (i < 0) return -1;
      if (this.LA(i).tokenType !== t.RParen) return -1;
      i += 1;
    }
    return i;
  }

  /**
   * true nếu phía trước là `Ident (: type)? (, Ident (: type)?)* |`
   * — tức phần khai báo iterator của forAll/exists/collect/closure/...
   */
  private isIteratorAhead(): boolean {
    if (this.RECORDING_PHASE) return true;
    let i = 1;
    if (this.LA(i).tokenType !== t.Identifier) return false;
    i += 1;
    if (this.LA(i).tokenType === t.Colon) {
      i = this.skipTypeAt(i + 1);
      if (i < 0) return false;
    }
    while (this.LA(i).tokenType === t.Comma) {
      i += 1;
      if (this.LA(i).tokenType !== t.Identifier) return false;
      i += 1;
      if (this.LA(i).tokenType === t.Colon) {
        i = this.skipTypeAt(i + 1);
        if (i < 0) return false;
      }
    }
    return this.LA(i).tokenType === t.Pipe;
  }

  // ---------- Rules ----------

  public oclFile = this.RULE('oclFile', () => {
    this.MANY(() => this.SUBRULE(this.contextDecl));
  });

  private contextDecl = this.RULE('contextDecl', () => {
    this.CONSUME(t.Context);
    this.SUBRULE(this.qualifiedName, { LABEL: 'contextName' });
    this.AT_LEAST_ONE(() => this.SUBRULE(this.invariant));
  });

  private invariant = this.RULE('invariant', () => {
    this.CONSUME(t.Inv);
    this.OPTION(() => this.CONSUME(t.Identifier, { LABEL: 'invName' }));
    this.CONSUME(t.Colon);
    this.SUBRULE(this.expression, { LABEL: 'body' });
  });

  private expression = this.RULE('expression', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.letExpr) },
      { ALT: () => this.SUBRULE(this.impliesExpr) },
    ]);
  });

  private letExpr = this.RULE('letExpr', () => {
    this.CONSUME(t.Let);
    this.SUBRULE(this.letBinding);
    this.MANY(() => {
      this.CONSUME(t.Comma);
      this.SUBRULE2(this.letBinding);
    });
    this.CONSUME(t.In);
    this.SUBRULE(this.expression, { LABEL: 'body' });
  });

  private letBinding = this.RULE('letBinding', () => {
    this.CONSUME(t.Identifier, { LABEL: 'varName' });
    this.OPTION(() => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.typeExpr, { LABEL: 'declaredType' });
    });
    this.CONSUME(t.Equals);
    this.SUBRULE(this.expression, { LABEL: 'value' });
  });

  private impliesExpr = this.RULE('impliesExpr', () => {
    this.SUBRULE(this.orExpr, { LABEL: 'lhs' });
    this.MANY(() => {
      this.CONSUME(t.Implies, { LABEL: 'op' });
      this.SUBRULE2(this.orExpr, { LABEL: 'rhs' });
    });
  });

  private orExpr = this.RULE('orExpr', () => {
    this.SUBRULE(this.andExpr, { LABEL: 'lhs' });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.Or, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.Xor, { LABEL: 'op' }) },
      ]);
      this.SUBRULE2(this.andExpr, { LABEL: 'rhs' });
    });
  });

  private andExpr = this.RULE('andExpr', () => {
    this.SUBRULE(this.notExpr, { LABEL: 'lhs' });
    this.MANY(() => {
      this.CONSUME(t.And, { LABEL: 'op' });
      this.SUBRULE2(this.notExpr, { LABEL: 'rhs' });
    });
  });

  private notExpr = this.RULE('notExpr', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(t.Not);
          this.SUBRULE(this.notExpr, { LABEL: 'operand' });
        },
      },
      { ALT: () => this.SUBRULE(this.comparison) },
    ]);
  });

  private comparison = this.RULE('comparison', () => {
    this.SUBRULE(this.additive, { LABEL: 'lhs' });
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.Equals, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.NotEq, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.LessEq, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.GreaterEq, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.Less, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.Greater, { LABEL: 'op' }) },
      ]);
      this.SUBRULE2(this.additive, { LABEL: 'rhs' });
    });
  });

  private additive = this.RULE('additive', () => {
    this.SUBRULE(this.multiplicative, { LABEL: 'lhs' });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.Plus, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.Minus, { LABEL: 'op' }) },
      ]);
      this.SUBRULE2(this.multiplicative, { LABEL: 'rhs' });
    });
  });

  private multiplicative = this.RULE('multiplicative', () => {
    this.SUBRULE(this.unary, { LABEL: 'lhs' });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(t.Star, { LABEL: 'op' }) },
        { ALT: () => this.CONSUME(t.Slash, { LABEL: 'op' }) },
      ]);
      this.SUBRULE2(this.unary, { LABEL: 'rhs' });
    });
  });

  private unary = this.RULE('unary', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(t.Minus);
          this.SUBRULE(this.unary, { LABEL: 'operand' });
        },
      },
      { ALT: () => this.SUBRULE(this.postfix) },
    ]);
  });

  private postfix = this.RULE('postfix', () => {
    this.SUBRULE(this.primary);
    this.MANY(() => this.SUBRULE(this.callSuffix));
  });

  /** Bọc dot/arrow trong một rule để giữ đúng THỨ TỰ các suffix trong CST */
  private callSuffix = this.RULE('callSuffix', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.dotSuffix) },
      { ALT: () => this.SUBRULE(this.arrowSuffix) },
    ]);
  });

  private dotSuffix = this.RULE('dotSuffix', () => {
    this.CONSUME(t.Dot);
    this.CONSUME(t.Identifier, { LABEL: 'prop' });
    this.OPTION(() => {
      this.CONSUME(t.LParen);
      this.OPTION2(() => this.SUBRULE(this.argList));
      this.CONSUME(t.RParen);
    });
  });

  private arrowSuffix = this.RULE('arrowSuffix', () => {
    this.CONSUME(t.Arrow);
    this.CONSUME(t.Identifier, { LABEL: 'opName' });
    this.CONSUME(t.LParen);
    this.OPTION(() => {
      // Cả hai ALT đều có thể bắt đầu bằng Identifier — GATE quyết định,
      // nên tắt cảnh báo ambiguity tĩnh của Chevrotain.
      this.OR({
        DEF: [
          {
            GATE: () => this.isIteratorAhead(),
            ALT: () => this.SUBRULE(this.iteratorBody),
          },
          { ALT: () => this.SUBRULE(this.argList) },
        ],
        IGNORE_AMBIGUITIES: true,
      });
    });
    this.CONSUME(t.RParen);
  });

  private iteratorBody = this.RULE('iteratorBody', () => {
    this.SUBRULE(this.iteratorVar);
    this.MANY(() => {
      this.CONSUME(t.Comma);
      this.SUBRULE2(this.iteratorVar);
    });
    this.CONSUME(t.Pipe);
    this.SUBRULE(this.expression, { LABEL: 'body' });
  });

  private iteratorVar = this.RULE('iteratorVar', () => {
    this.CONSUME(t.Identifier, { LABEL: 'name' });
    this.OPTION(() => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.typeExpr, { LABEL: 'declaredType' });
    });
  });

  private argList = this.RULE('argList', () => {
    this.SUBRULE(this.expression);
    this.MANY(() => {
      this.CONSUME(t.Comma);
      this.SUBRULE2(this.expression);
    });
  });

  private primary = this.RULE('primary', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.CONSUME(t.Self) },
      { ALT: () => this.SUBRULE(this.ifExpr) },
      {
        ALT: () => {
          this.CONSUME(t.LParen);
          this.SUBRULE(this.expression, { LABEL: 'paren' });
          this.CONSUME(t.RParen);
        },
      },
      { ALT: () => this.SUBRULE(this.collectionLiteral) },
      { ALT: () => this.SUBRULE(this.nameOrCall) },
    ]);
  });

  private literal = this.RULE('literal', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.NumberLiteral) },
      { ALT: () => this.CONSUME(t.StringLiteral) },
      { ALT: () => this.CONSUME(t.True) },
      { ALT: () => this.CONSUME(t.False) },
      { ALT: () => this.CONSUME(t.Null) },
    ]);
  });

  private ifExpr = this.RULE('ifExpr', () => {
    this.CONSUME(t.If);
    this.SUBRULE(this.expression, { LABEL: 'condition' });
    this.CONSUME(t.Then);
    this.SUBRULE2(this.expression, { LABEL: 'thenExpr' });
    this.CONSUME(t.Else);
    this.SUBRULE3(this.expression, { LABEL: 'elseExpr' });
    this.CONSUME(t.Endif);
  });

  private collectionLiteral = this.RULE('collectionLiteral', () => {
    this.OR([
      { ALT: () => this.CONSUME(t.SetKw, { LABEL: 'kind' }) },
      { ALT: () => this.CONSUME(t.BagKw, { LABEL: 'kind' }) },
      { ALT: () => this.CONSUME(t.SequenceKw, { LABEL: 'kind' }) },
      { ALT: () => this.CONSUME(t.OrderedSetKw, { LABEL: 'kind' }) },
    ]);
    this.CONSUME(t.LBrace);
    this.OPTION(() => this.SUBRULE(this.argList));
    this.CONSUME(t.RBrace);
  });

  private nameOrCall = this.RULE('nameOrCall', () => {
    this.SUBRULE(this.qualifiedName);
    this.OPTION(() => {
      this.CONSUME(t.LParen);
      this.OPTION2(() => this.SUBRULE(this.argList));
      this.CONSUME(t.RParen);
    });
  });

  private qualifiedName = this.RULE('qualifiedName', () => {
    this.CONSUME(t.Identifier, { LABEL: 'part' });
    this.MANY(() => {
      this.CONSUME(t.DoubleColon);
      this.CONSUME2(t.Identifier, { LABEL: 'part' });
    });
  });

  private typeExpr = this.RULE('typeExpr', () => {
    this.OR([
      {
        ALT: () => {
          this.OR2([
            { ALT: () => this.CONSUME(t.SetKw, { LABEL: 'collectionKind' }) },
            { ALT: () => this.CONSUME(t.BagKw, { LABEL: 'collectionKind' }) },
            { ALT: () => this.CONSUME(t.SequenceKw, { LABEL: 'collectionKind' }) },
            { ALT: () => this.CONSUME(t.OrderedSetKw, { LABEL: 'collectionKind' }) },
          ]);
          this.CONSUME(t.LParen);
          this.SUBRULE(this.typeExpr, { LABEL: 'elementType' });
          this.CONSUME(t.RParen);
        },
      },
      { ALT: () => this.SUBRULE(this.qualifiedName, { LABEL: 'typeName' }) },
    ]);
  });
}

/** Singleton — Chevrotain khuyến nghị tái sử dụng một parser instance */
export const oclParserInstance = new OclCstParser();
