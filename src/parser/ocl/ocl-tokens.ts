/**
 * Định nghĩa token cho OCL subset (Chevrotain lexer).
 *
 * Lưu ý thứ tự trong `allTokens`:
 *  - keyword đứng trước Identifier, dùng `longer_alt` để "invariant" không bị
 *    ăn nhầm thành keyword `inv` + Identifier.
 *  - token nhiều ký tự (`->`, `::`, `<=`, `>=`, `<>`) đứng trước token tiền tố
 *    của chúng (`-`, `:`, `<`, `>`).
 */
import { createToken, Lexer, TokenType } from 'chevrotain';

// ---------- Trivia ----------
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

/** Comment kiểu OCL: `-- ...` đến hết dòng */
export const LineComment = createToken({
  name: 'LineComment',
  pattern: /--[^\n\r]*/,
  group: Lexer.SKIPPED,
});

// ---------- Identifier (khai báo trước để keyword tham chiếu longer_alt) ----------
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
});

const keyword = (name: string, word: string): TokenType =>
  createToken({ name, pattern: new RegExp(word), longer_alt: Identifier });

// ---------- Keywords ----------
export const Context = keyword('Context', 'context');
export const Inv = keyword('Inv', 'inv'); // PHẢI đứng trước In trong allTokens
export const Let = keyword('Let', 'let');
export const In = keyword('In', 'in');
export const If = keyword('If', 'if');
export const Then = keyword('Then', 'then');
export const Else = keyword('Else', 'else');
export const Endif = keyword('Endif', 'endif');
export const Not = keyword('Not', 'not');
export const And = keyword('And', 'and');
export const Or = keyword('Or', 'or');
export const Xor = keyword('Xor', 'xor');
export const Implies = keyword('Implies', 'implies');
export const True = keyword('True', 'true');
export const False = keyword('False', 'false');
export const Null = keyword('Null', 'null');
export const Self = keyword('Self', 'self');
export const SetKw = keyword('SetKw', 'Set');
export const BagKw = keyword('BagKw', 'Bag');
export const SequenceKw = keyword('SequenceKw', 'Sequence');
export const OrderedSetKw = keyword('OrderedSetKw', 'OrderedSet');

/** Các keyword kiểu collection — dùng cho literal `Set{...}` và kiểu `Set(Role)` */
export const collectionKinds: TokenType[] = [OrderedSetKw, SequenceKw, SetKw, BagKw];

// ---------- Literals ----------
export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /\d+(\.\d+)?/,
});
export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /'[^'\\]*(?:\\.[^'\\]*)*'/,
});

// ---------- Operators / punctuation ----------
export const Arrow = createToken({ name: 'Arrow', pattern: /->/ });
export const DoubleColon = createToken({ name: 'DoubleColon', pattern: /::/ });
export const LessEq = createToken({ name: 'LessEq', pattern: /<=/ });
export const GreaterEq = createToken({ name: 'GreaterEq', pattern: />=/ });
export const NotEq = createToken({ name: 'NotEq', pattern: /<>/ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const Less = createToken({ name: 'Less', pattern: /</ });
export const Greater = createToken({ name: 'Greater', pattern: />/ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });

// ---------- Thứ tự lexing ----------
export const allTokens: TokenType[] = [
  WhiteSpace,
  LineComment, // trước Arrow/Minus để `--` là comment

  // keywords (Inv trước In; OrderedSet trước Set không bắt buộc nhưng giữ cho rõ)
  Context, Inv, Let, In, If, Then, Else, Endif,
  Not, And, Or, Xor, Implies,
  True, False, Null, Self,
  OrderedSetKw, SequenceKw, SetKw, BagKw,

  Identifier,
  NumberLiteral,
  StringLiteral,

  // multi-char trước prefix
  Arrow, DoubleColon, LessEq, GreaterEq, NotEq,
  Equals, Less, Greater,
  Plus, Minus, Star, Slash,
  LParen, RParen, LBrace, RBrace,
  Comma, Colon, Dot, Pipe,
];

export const OclLexer = new Lexer(allTokens, {
  positionTracking: 'full',
});
