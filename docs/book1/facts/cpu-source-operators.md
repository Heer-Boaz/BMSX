# CPU source operator addendum — frozen 2026-10-17

Scope: ordinary cartridge-source producer only, not on-console source loading or a claim that a whole source expression takes one instruction. No mirrored-runtime change. No architecture/PDF. Sources are the owning lexer, parser and compiler, not foreign Lua assumptions.

- S01. Spellings `+ - * / // % ^ & | ~ << >>` tokenize as Plus, Minus, Star, Slash, FloorDivide, Percent, Caret, Ampersand, Pipe, Tilde, ShiftLeft, ShiftRight. Sources: `toolchain/ts/lua/syntax/lexer.ts:142–199`.
- S02. Binary parser maps them to Add, Subtract, Multiply, Divide, FloorDivide, Modulus, Exponent, BitwiseAnd, BitwiseOr, BitwiseXor, ShiftLeft, ShiftRight. Sources: `toolchain/ts/lua/syntax/parser.ts:115–130,1083`.
- S03. When ordinary binary expressions reach non-folded arithmetic lowering, they emit ADD, SUB, MUL, DIV, FLOORDIV, MOD, POW, BAND, BOR, BXOR, SHL, SHR respectively. Both operands are compiled as RK. This is not a total expression cost or an unconditional promise against compile/link-time folding. Sources: `toolchain/ts/lua/compiler.ts:5344–5350,5375–5423`.
- S04. Source `== ~= < <= > >=` tokenize as comparison tokens; parser maps to Equal/NotEqual/LessThan/LessEqual/GreaterThan/GreaterEqual. Sources: `toolchain/ts/lua/syntax/lexer.ts:175–194`; `toolchain/ts/lua/syntax/parser.ts:107–114`.
- S05. Non-folded comparison values lower to EQ/LT/LE plus Boolean initialization, conditional skip and jump: == EQ expectedtrue; ~= EQ expectedfalse; < LT true; <= LE true; > LT with reversed operands; >= LE with reversed operands. A comparison source value is not a destination-writing comparison opcode. Sources: `toolchain/ts/lua/compiler.ts:5357–5374,5425–5443`.
- S06. Source unary `not`, `-`, `#`, `~` parse as Not, Negate, Length, BitwiseNot and ordinary runtime lowering uses NOT, UNM, LEN, BNOT. Static storage-array # instead emits its known element count. These unary instructions read a register operand, not RK. Sources: `toolchain/ts/lua/syntax/parser.ts:1058–1077`; `toolchain/ts/lua/compiler.ts:5289–5302,5324–5338`.
- S07. `and` and `or` take separate compiler branches rather than arithmetic opcodes. The complete short-circuit lowering/precedence is outside this addendum. Source: `toolchain/ts/lua/compiler.ts:5351–5356`.
- S08. `..` tokenizes as DotDot. Binary Concat routes to compileConcatExpression, not an unconditional one-CONCAT claim. Exact concat flattening is outside this addendum. Sources: `toolchain/ts/lua/syntax/lexer.ts:204–213`; `toolchain/ts/lua/compiler.ts:5408–5410`.
- S09. emitLoadNil(target,count) emits KNIL for count1, LOADNIL for every other count. This helper alone does NOT establish that all producer callsites omit count0; do not claim zero-count is unreachable. Source: `toolchain/ts/lua/compiler.ts:3132–3138`.

## Later logical-expression scope

The former S07 scope exclusion is covered separately by [the logical-expression extraction](cpu-logical-expressions.md). It does not change this frozen arithmetic/bitwise extraction or settle the seven stopped owner contracts.
