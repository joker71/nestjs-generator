# OCL-subset parser cho RBAC (Chevrotain)

Parser cho file `.ocl` đồng hành với sơ đồ PlantUML (quy ước `X.puml` + `X.ocl`,
xem tech-report §4.2). Subset đủ biểu diễn invariant RBAC₀–RBAC₂ của Sandhu et al.
(1996) theo phong cách UML + OCL của Ray, Li, France (2004), kèm ràng buộc
cross-domain (role mapping acyclic, no privilege escalation, SSD/DSD xuyên miền).

## Cài đặt

```bash
npm install chevrotain
```

## Sử dụng

```ts
import { parseOcl, validateRbacOcl } from './src/parser/ocl';
import * as fs from 'fs';

const source = fs.readFileSync('examples/CourseManagementRbac.ocl', 'utf8');
const { ast, errors } = parseOcl(source, 'CourseManagementRbac.ocl');

if (errors.length > 0) {
  console.error(errors);
} else {
  // Cảnh báo context lạ + kiểm tra collection op hợp lệ
  const diags = validateRbacOcl(ast!, {
    knownContexts: ['Student', 'CourseModule', 'Enrolment'], // từ DomainMetamodel
  });
  console.log(diags);
}
```

## Grammar (EBNF)

```ebnf
oclFile        ::= contextDecl* ;
contextDecl    ::= 'context' qualifiedName invariant+ ;
invariant      ::= 'inv' Identifier? ':' expression ;

expression     ::= letExpr | impliesExpr ;
letExpr        ::= 'let' letBinding (',' letBinding)* 'in' expression ;
letBinding     ::= Identifier (':' typeExpr)? '=' expression ;

(* Ưu tiên toán tử từ thấp đến cao: implies < or/xor < and < not < so sánh < +- < */ *)
impliesExpr    ::= orExpr ('implies' orExpr)* ;
orExpr         ::= andExpr (('or' | 'xor') andExpr)* ;
andExpr        ::= notExpr ('and' notExpr)* ;
notExpr        ::= 'not' notExpr | comparison ;
comparison     ::= additive (('=' | '<>' | '<' | '<=' | '>' | '>=') additive)? ;
additive       ::= multiplicative (('+' | '-') multiplicative)* ;
multiplicative ::= unary (('*' | '/') unary)* ;
unary          ::= '-' unary | postfix ;

postfix        ::= primary (dotSuffix | arrowSuffix)* ;
dotSuffix      ::= '.' Identifier ('(' argList? ')')? ;
arrowSuffix    ::= '->' Identifier '(' (iteratorBody | argList)? ')' ;
iteratorBody   ::= iteratorVar (',' iteratorVar)* '|' expression ;
iteratorVar    ::= Identifier (':' typeExpr)? ;
argList        ::= expression (',' expression)* ;

primary        ::= literal | 'self' | ifExpr | '(' expression ')'
                 | collectionLiteral | nameOrCall ;
ifExpr         ::= 'if' expression 'then' expression 'else' expression 'endif' ;
collectionLiteral ::= collectionKind '{' argList? '}' ;
nameOrCall     ::= qualifiedName ('(' argList? ')')? ;
qualifiedName  ::= Identifier ('::' Identifier)* ;   (* Domain::Role *)
typeExpr       ::= collectionKind '(' typeExpr ')' | qualifiedName ;
collectionKind ::= 'Set' | 'Bag' | 'Sequence' | 'OrderedSet' ;

literal        ::= Number | String | 'true' | 'false' | 'null' ;
(* comment: '--' đến hết dòng; string: nháy đơn *)
```

Điểm kỹ thuật đáng chú ý: sau `->op(` grammar phải phân biệt iterator
(`forAll(r | ...)`, `forAll(r : Role | ...)`, `forAll(p, q | ...)`) với argument
thường (`includes(x)`). Vì cả hai đều bắt đầu bằng `Identifier`, parser dùng một
custom GATE (`isIteratorAhead` trong `ocl-cst-parser.ts`) quét lookahead tìm `|`
— tránh backtracking, giữ parser tuyến tính.

## Collection op được hỗ trợ

| Nhóm | Op |
|---|---|
| Iterator | `forAll` `exists` `select` `reject` `collect` `closure` `any` `one` `isUnique` `sortedBy` |
| Kiểm tra | `size` `isEmpty` `notEmpty` `includes` `excludes` `includesAll` `excludesAll` `count` `sum` |
| Biến đổi | `asSet` `asBag` `asSequence` `asOrderedSet` `union` `intersection` `symmetricDifference` `including` `excluding` `flatten` `first` `last` `at` `indexOf` |

`closure` (OCL 2.3) quan trọng cho RBAC₁: bao đóng bắc cầu của role hierarchy —
`self.juniors->closure(j | j.juniors)->excludes(self)` là invariant acyclicity.

## Kiến trúc

```
ocl-tokens.ts       — token + lexer (comment --, keyword, operator đa ký tự)
ocl-cst-parser.ts   — CST parser (Chevrotain CstParser) + gate iterator
ocl-ast-builder.ts  — visitor CST → AST
ocl-ast.ts          — kiểu AST + diagnostics
index.ts            — parseOcl(), validateRbacOcl(), walkExpression()
```

AST kết quả (`OclFile`) gắn vào `DomainMetamodel.oclInvariants` ở bước
transformer; Stage 4 (verify) export nguyên văn sang định dạng USE để
kiểm chứng OCL đầy đủ — parser này chỉ cần đủ cấu trúc để (i) validate sớm,
(ii) sinh guard/policy check trong NestJS.

## Những gì KHÔNG thuộc subset

`pre`/`post` condition, `def:`/`derive:`, `@pre`, message expression (`^`),
tuple literal, `Tuple(...)` type, `oclAsType` ép kiểu có kiểm tra. Nếu cần,
mở rộng theo đúng pattern rule + visitor hiện có.
