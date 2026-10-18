# BIOS exported syntax-interface fact sheet (read-only audit; frozen)

Status: FROZEN AND COMPLETE within the bounded syntax-export and directly consumed representation audit. This is an evidence sheet, not a chapter or an ABI/stability promise. No repo edits, builds, tests, guest execution, docs/architecture.md, or foreignPDFs have been used. Scope is actual `compiler/api` syntax exports and directly consumed representations. Cartridge permission, module-loader publication beyond observed installation, host compiler equivalence, and allocation internals are deliberately unverified here.

## 1. Actual installation and API boundary

- BIOS entry installs `lua_compiler = require('compiler/api')` and `load = lua_compiler.load` as assignments, not a distinct syntax global (`machine/bios/main.lua:4-10`). `compiler/api` returns one ordinary table with three members: `compile_syntax`, `syntax_factory`, `load` (`machine/bios/compiler/api.lua:4-24`). Export alone is not evidence of stable cartridge ABI or allowed cartridge access.
- `compile_syntax` is the function identity `load_compiler.compile_chunk`, not a protected wrapper (`machine/bios/compiler/api.lua:4-6`). Signature: `compile_syntax(chunk, chunk_name, environment, external_scope)`; one explicit successful result, a root callable closure (`machine/bios/compiler/load.lua:27-38`). No AST/chunk-name default is applied on this route in that file. It calls compiler, linker, then closure construction; parser is not invoked (`machine/bios/compiler/load.lua:21-38`). Error capture differs from `load`: `load` wraps text compilation with `__bmsx_pcall` and explicitly returns either one result or two (`nil,error`); syntax compilation has no such wrapper (`machine/bios/compiler/api.lua:2,9-22`).
- Text route, for contrast only: `load(source,chunk_name,mode,environment,external_scope)` -> protected `load_compiler.compile` -> accept omitted mode or any mode containing byte 116 (`t`), reject otherwise; `chunk_name = chunk_name or '=(load)'`; parser.parse -> compile_chunk (`machine/bios/compiler/load.lua:9-19,40-47`). The root agent owns full public load documentation.
- Observed BIOS consumer: REPL binds `require('compiler/api').load` and includes `lua_compiler` in its environment (`machine/bios/shell/repl.lua:1,21`). A search within `machine/**/*.lua` found no non-factory compile_syntax/syntax_factory callsites; this is an observed search scope, not proof of external prohibition.

## 2. Complete `syntax_factory` callable export inventory

Every callable below has one explicit return value; none supplies argument defaults. Node constructors copy/store supplied references and values, not recursive clones. Each tagged node sets `line=1,column=1`; helper records `generated_symbol`, `if_clause`, `else_clause` lack those fields. Every node/tag field is listed below. `syntax_factory.syntax` exports the syntax-constant table (`machine/bios/compiler/syntax_factory.lua:1-18`). These are guest Lua tables, not host DTO ASTs.

| Callable signature | Returned fields beyond common `line,column` | Evidence |
|---|---|---|
| `chunk(body)` | `kind=syntax.chunk, body` | `machine/bios/compiler/syntax_factory.lua:12-19` |
| `block(statements)` | `kind=syntax.block, statements` | `machine/bios/compiler/syntax_factory.lua:21-28` |
| `identifier(name)` | `kind=syntax.identifier_expression, name` | `machine/bios/compiler/syntax_factory.lua:30-37` |
| `generated_symbol(name)` | untagged record `{name=name}` | `machine/bios/compiler/syntax_factory.lua:39-44` |
| `reference(symbol)` | `kind=syntax.identifier_expression, name=symbol` | `machine/bios/compiler/syntax_factory.lua:46-53` |
| `number_literal(value)` | `kind=syntax.number_literal_expression, value` | `machine/bios/compiler/syntax_factory.lua:55-62` |
| `string_literal(value)` | `kind=syntax.string_literal_expression, value` | `machine/bios/compiler/syntax_factory.lua:64-71` |
| `boolean_literal(value)` | `kind=syntax.boolean_literal_expression, value` | `machine/bios/compiler/syntax_factory.lua:73-80` |
| `nil_literal()` | `kind=syntax.nil_literal_expression` | `machine/bios/compiler/syntax_factory.lua:82-88` |
| `literal(value)` | dispatches by `type(value)` to number/string/boolean constructor; nil is not in dispatch table | `machine/bios/compiler/syntax_factory.lua:90-98` |
| `member_expression(base,identifier)` | `kind=syntax.member_expression, base, identifier` | `machine/bios/compiler/syntax_factory.lua:100-108` |
| `index_expression(base,index)` | `kind=syntax.index_expression, base, index` | `machine/bios/compiler/syntax_factory.lua:110-118` |
| `index_path(base,path)` | starts with supplied base; for each `path[1..#path]` wraps previous expression in `index_expression(previous,literal(path[index]))`; empty path returns original base | `machine/bios/compiler/syntax_factory.lua:120-129` |
| `call_expression(callee,arguments,method_name)` | `kind=syntax.call_expression, expands_results=true, callee, arguments, method_name` | `machine/bios/compiler/syntax_factory.lua:131-141` |
| `binary_expression(operator,left,right)` | `kind=syntax.binary_expression, operator, left, right` | `machine/bios/compiler/syntax_factory.lua:143-152` |
| `unary_expression(operator,operand)` | `kind=syntax.unary_expression, operator, operand` | `machine/bios/compiler/syntax_factory.lua:154-162` |
| `function_expression(parameters,body)` | `kind=syntax.function_expression, parameters, body` | `machine/bios/compiler/syntax_factory.lua:164-172` |
| `assignment_statement(target,value)` | `kind=syntax.assignment_statement, target, value` (one target and one value, not lists) | `machine/bios/compiler/syntax_factory.lua:174-182` |
| `local_statement(name,initializer,is_const)` | `kind=syntax.local_statement, name, is_const, initializer` | `machine/bios/compiler/syntax_factory.lua:184-193` |
| `call_statement(expression)` | `kind=syntax.call_statement, expression` | `machine/bios/compiler/syntax_factory.lua:195-202` |
| `if_clause(condition,block)` | untagged record `{condition=condition,block=block}` | `machine/bios/compiler/syntax_factory.lua:204-209` |
| `else_clause(block)` | untagged record `{block=block}` | `machine/bios/compiler/syntax_factory.lua:211-215` |
| `if_statement(clauses)` | `kind=syntax.if_statement, clauses` | `machine/bios/compiler/syntax_factory.lua:217-224` |
| `while_statement(condition,block)` | `kind=syntax.while_statement, condition, block` | `machine/bios/compiler/syntax_factory.lua:226-234` |
| `numeric_for_statement(variable,start_expression,limit_expression,step_expression,block)` | `kind=syntax.numeric_for_statement, variable, start_expression, limit_expression, step_expression, block` | `machine/bios/compiler/syntax_factory.lua:236-253` |
| `return_statement(expressions)` | `kind=syntax.return_statement, expressions` | `machine/bios/compiler/syntax_factory.lua:255-262` |
| `break_statement()` | `kind=syntax.break_statement` | `machine/bios/compiler/syntax_factory.lua:264-270` |

### Exported `syntax_factory.syntax` constants (all constants, no callables)

- Node tags: `chunk=1`, `block=2`, `assignment_statement=3`, `return_statement=4`, `function_expression=5`, `identifier_expression=6`, `member_expression=7`, `index_expression=8`, `number_literal_expression=9`, `string_literal_expression=10`, `boolean_literal_expression=11`, `nil_literal_expression=12`, `unary_expression=13`, `binary_expression=14`, `call_expression=15`, `local_statement=16`, `if_statement=17`, `while_statement=18`, `break_statement=19`, `call_statement=20`, `numeric_for_statement=21` (`machine/bios/compiler/syntax.lua:1-22`).
- Unary operators: `unary_negate=1`, `unary_string_id=2`, `unary_not=3`, `unary_length=4` (`machine/bios/compiler/syntax.lua:24-27`).
- Binary operators: `binary_add=1`, `binary_subtract=2`, `binary_multiply=3`, `binary_divide=4`, `binary_floor_divide=5`, `binary_modulus=6`, `binary_equal=7`, `binary_not_equal=8`, `binary_less=9`, `binary_less_equal=10`, `binary_greater=11`, `binary_greater_equal=12`, `binary_and=13`, `binary_or=14`, `binary_bitwise_and=15` (`machine/bios/compiler/syntax.lua:29-44`). Node-kind/operator integer spaces overlap; field context distinguishes them. No token table is exported by API or factory (`machine/bios/compiler/api.lua:4-7,9-24`; `machine/bios/compiler/syntax_factory.lua:6-8,272`).

## 3. Completed directly consumed shape/ownership scope

Sections 4-7 complete the consumed-shape, mutation, function/loop/local parameter, name/symbol, list, error, compile/link, and direct external-capture/environment audit. Deliberately excluded owner boundaries remain listed in sections 6 and 8; this packet makes no claim to complete the overall chapter.

## 4. Consumed shapes: enough to use constructors rather than hand-author AST encoders

The factory interface uses ordinary guest Lua values/tables. The constructor parameter called `name` is not interchangeable across constructors:

| Field/input | Representation actually consumed | Evidence |
|---|---|---|
| `chunk.body`; function `.body`; clause/while/for `.block` | block node with `.statements` list, normally produced by `block({...})` | `machine/bios/compiler/semantic.lua:314-346,374-405,409-435` |
| `block.statements` | ordinary 1-based statement list; consumed with `for index=1,#statements` and direct indexing | `machine/bios/compiler/semantic.lua:374-385`; `machine/bios/compiler/compiler.lua:1642-1647` |
| `function_expression.parameters` | ordinary 1-based list of identifier occurrence nodes, **not strings**; parameter `.name` is the binding key and `.binding` is written in place | `machine/bios/compiler/semantic.lua:84-107`; parser confirms production by identifier-expression records, `machine/bios/compiler/parser.lua:552-581` |
| `local_statement.name` | identifier occurrence node, **not a spelling string or bare generated-symbol record**; binder reads `.name`, writes `.binding`; use `identifier('x')` or a fresh `reference(symbol)` | `machine/bios/compiler/semantic.lua:68-82,290-305`; parser `machine/bios/compiler/parser.lua:399-406` |
| `numeric_for_statement.variable` | identifier occurrence node (same declaration-role requirement) | `machine/bios/compiler/semantic.lua:332-346`; parser `machine/bios/compiler/parser.lua:474-483`; codegen `machine/bios/compiler/compiler.lua:1420-1424` |
| `identifier_expression.name` | string spelling for ordinary lexical lookup, or generated-symbol table identity; lexical maps index the exact key, with no spelling reconstruction | `machine/bios/compiler/semantic.lua:68-81,84-105,129-194`; factory `machine/bios/compiler/syntax_factory.lua:30-53` |
| `member_expression.identifier` | member key value itself (parser supplies identifier spelling string), **not an identifier-expression node**; binder assigns it directly to `.key_value` | `machine/bios/compiler/semantic.lua:203-206`; parser `machine/bios/compiler/parser.lua:196-204` |
| `index_expression.base` / member `.base` | identifier-rooted path, recursively composed from identifier/member/index nodes; not arbitrary expression/call/table constructor | `machine/bios/compiler/semantic.lua:197-218` |
| `index_expression.index` | expression node; runtime key if not a semantic constant, constant key otherwise | `machine/bios/compiler/semantic.lua:208-215`; `machine/bios/compiler/compiler.lua:100-116` |
| `call_expression.callee` | expression; when `method_name=nil`, the callable expression; when method_name is supplied, the **receiver expression**, not an already selected member | `machine/bios/compiler/semantic.lua:243-249`; `machine/bios/compiler/compiler.lua:604-647` |
| `call_expression.arguments` | ordinary 1-based expression list, use `{}` for no arguments; method receiver is inserted by compiler, not supplied as first explicit argument | `machine/bios/compiler/semantic.lua:243-249`; `machine/bios/compiler/compiler.lua:604-651` |
| `call_expression.method_name` | omitted/nil for ordinary call; supplied method key (parser identifier spelling string) triggers receiver lookup and implicit self | `machine/bios/compiler/parser.lua:216-241`; `machine/bios/compiler/compiler.lua:139-144,604-651` |
| `return_statement.expressions` | ordinary 1-based expression list; use `{}` for empty return | `machine/bios/compiler/semantic.lua:307-312`; `machine/bios/compiler/compiler.lua:1133-1186` |
| `if_statement.clauses` | ordinary 1-based list of untagged `if_clause(condition,block)` / `else_clause(block)` records; nil/absent condition selects unconditional clause | `machine/bios/compiler/semantic.lua:314-323`; `machine/bios/compiler/compiler.lua:1354-1383` |
| binary/unary `.operator` | numeric **syntax operator constant** from `factory.syntax`, not token enum, source spelling string, opcode, or hand-encoded word | `machine/bios/compiler/syntax.lua:24-44`; compiler tables `machine/bios/compiler/compiler.lua:14-37,763-789,869-884` |
| literal `.value` | guest literal value supplied directly to constructor; number/string constants flow into constant pool (or compiler-selected number immediate), boolean emission uses its Lua truth value, nil literal needs no value | `machine/bios/compiler/semantic.lua:18-35,234-264`; `machine/bios/compiler/compiler.lua:61-70,151-167,887-922` |
| `index_path.path` | ordinary 1-based list of raw number/string/boolean values, not expression nodes; each element goes through `literal` | `machine/bios/compiler/syntax_factory.lua:90-98,120-129` |

All list sites above use `#list` and consecutive `list[index]`, not `.n` or `table.pack`; no default empty lists, hole filling, token decoding, or host-object conversion occurs. Empty lists must be actual `{}` tables at those sites. Statement/argument/return/parameter/clause consumption evidence is above. `index_path` returns the supplied base unchanged for an empty path (`machine/bios/compiler/syntax_factory.lua:120-129`).

### Optional arguments versus compiler defaults

- Constructor functions do not normalize/default inputs; they store them. Their absent/nil optional fields are meaningful to consumers (`machine/bios/compiler/syntax_factory.lua:131-141,184-193,236-253`).
- `local_statement(name,nil,false)` (or omitted false flag) declares a mutable local initialized by codegen to nil. A truthy `is_const` requires an initializer; binding the initializer precedes declaration of this local (`machine/bios/compiler/semantic.lua:290-305`; `machine/bios/compiler/compiler.lua:1102-1114`). Thus this is not an implicit recursive-local declaration facility: an initializer's same-spelling name resolves to whatever was already visible.
- `numeric_for_statement(variable,start,limit,nil,block)` has a compiler-defined step of positive one. Because block is the fifth argument, pass nil in the fourth position to omit step (`machine/bios/compiler/compiler.lua:1457-1489`). Start, limit, variable, and block are not optional in the consuming route (`machine/bios/compiler/semantic.lua:332-346`).
- `call_expression(callee,arguments)` is ordinary call; supplying third argument selects method form. Factory sets `expands_results=true` on every call node (`machine/bios/compiler/syntax_factory.lua:131-141`). Other constructors do not provide a parenthesis/single-result helper. See result count below.
- `literal(nil)` is not `nil_literal()`: dispatch supports only number/string/boolean, so nil reaches an absent callable entry. This factory-call error occurs during construction, before compile_syntax (`machine/bios/compiler/syntax_factory.lua:82-98`). Table/function values are likewise outside that dispatch. Do not add a local literal encoder as a workaround.

### Symbol identity and lexical capture

`symbol = generated_symbol('display-name')` returns a distinct table. A declaration uses a fresh `reference(symbol)` node; every later occurrence uses a separate fresh `reference(symbol)`. Share the **symbol key**, not the identifier node. Two separately constructed symbols with equal `.name` remain separate lexical keys because semantic maps index `.name` directly; `.name.name` is used only for diagnostic spelling (`machine/bios/compiler/syntax_factory.lua:39-53`; `machine/bios/compiler/semantic.lua:10-16,68-105,151-194`). Ordinary `identifier('x')` uses the string key and normal shadowing map (`machine/bios/compiler/semantic.lua:53-59,68-82,151-157`).

Nested function binding searches current locals then parameters, then recursively visible parent bindings as upvalues; shared captured bindings receive upvalue records. Unresolved **string** keys then try external names, then environment or global lookup. An unresolved generated-symbol key fails rather than becoming a global (`machine/bios/compiler/semantic.lua:109-194`). Every new nested function resets loop_depth=0 and inherits environment/external-name availability, not the caller's live Lua lexical scope (`machine/bios/compiler/semantic.lua:387-407`). The synthetic root has an empty parameter list and no semantic parent (`machine/bios/compiler/semantic.lua:409-435`). Thus compile_syntax does not capture arbitrary locals of its BIOS caller merely by spelling; generated lexical declarations, environment/external references, and compiler-owned constant-pool capture are distinct mechanisms.

## 5. Result counts, errors, work, and mutation boundaries

### Compiling is not executing

`compile_syntax` synchronously binds and compiles all nested functions, links their function/upvalue records and instruction words, then returns one root closure. It does **not** call that root closure (`machine/bios/compiler/load.lua:21-38`; `machine/bios/compiler/compiler.lua:1881-1951`; `machine/bios/compiler/linker.lua:7-72`). It bypasses lexing/parsing but not semantic binding, constant preparation, register planning, bytecode generation, linking, RAM ownership, or closure allocation. The linker calls arena.allocate before patching address constants and writing records/code (`machine/bios/compiler/linker.lua:25-68`). Arena/allocator lifetime details are deliberately delegated to the lifetime audit.

### Result tuple behavior actually present

- Constructor/helper success: one returned value each (inventory above). Compile success: one closure, not `closure,error` and not a program/AST (`machine/bios/compiler/load.lua:27-38`). Text load protection is a different boundary (`machine/bios/compiler/api.lua:9-22`).
- General call expression in a single-value expression context requests one result (`machine/bios/compiler/compiler.lua:859-867`). A call statement also requests one result internally, then its temporary area is reset; there is no returned language value from the statement (`machine/bios/compiler/compiler.lua:1613-1626,1642-1647`).
- Final argument or final returned expression expands a call's tuple only if its `.kind` is call_expression and `.expands_results` is truthy (`machine/bios/compiler/compiler.lua:648-683,1148-1185`). Factory initializes that field to true. Parser's parenthesized call changes it to false (`machine/bios/compiler/parser.lua:177-183`). There is no factory callable for that operation; for the exact single-result final-call representation, an owned factory call node's existing `expands_results` field must be set false before compilation. This is a field the producer/parser actually uses, not a new local AST encoder.
- **Current behavior, not standard-Lua inference:** empty `return_statement({})` emits nil followed by RET count 1; a function whose final top-level statement is not return likewise gets a nil/one-result fallthrough (`machine/bios/compiler/compiler.lua:1133-1146,1738-1745`). Ordinary fixed return list uses its expression_count; final expanding call forwards variable tuple with RET count 0 (`machine/bios/compiler/compiler.lua:1151-1185`).

### In-place ownership; do not share occurrences or recompile an annotated tree

The factory's own ownership instruction states that semantic binding/codegen annotate nodes in place, each call creates an owned syntax occurrence, and generated programs must not retain/share nodes between trees (`machine/bios/compiler/syntax_factory.lua:3-5,39-41`). Arguments/lists/children are stored directly by constructors, not cloned (all constructor bodies in `machine/bios/compiler/syntax_factory.lua:12-270`). A declaration node and each reference node are separate occurrences even when they carry the same generated-symbol key.

Observed annotation fields:

- Binding stage: identifier `.binding`, `.upvalue`, `.external_binding`, `.environment_key`, `.global_key`; path `.key_value`; expression `.constant_value`; numeric-for `.limit_local_slot`, `.step_local_slot`; function `.semantic_state`, `.local_count` (`machine/bios/compiler/semantic.lua:68-105,151-185,197-215,251-264,332-346,387-407`). Synthetic root function is newly constructed from chunk.body; nested function nodes themselves receive annotations (`machine/bios/compiler/semantic.lua:387-435`).
- Codegen preparation: `.constant_index`, `.accessor_constant_index`, `.immediate_index`, `.method_constant_index`, `.immediate_number` (which can later be cleared), numeric-for `.zero_constant_index`; nested function `.function_address_constant_index` (`machine/bios/compiler/compiler.lua:76-167,170-208,252-260,1906-1915`). These are compiler-owned annotations; callers provide constructor inputs, not precomputed codegen fields/words.
- There is no deep copy, clean-tree normalization, validation pass, or rollback around these mutations in the observed compile route (`machine/bios/compiler/load.lua:27-38`; semantic/codegen assignments above). A failure may follow previous in-place writes. Do not promise that failed/used syntax can simply be retried or shared.
- API/factory/syntax modules return ordinary tables; the files contain no freeze/read-only facade. Factory exports its required syntax table directly (`machine/bios/compiler/api.lua:4-24`; `machine/bios/compiler/syntax_factory.lua:1-8,272`; `machine/bios/compiler/syntax.lua:1-46`). That does not make mutating compiler constants a supported customization API.

### Proven language/shape rejection versus no general AST validation

`semantic.fail` raises `[load:<chunk_name>] <message> at <line>:<column>` (`machine/bios/compiler/semantic.lua:5-8`). Factory-generated locations are 1:1 (`machine/bios/compiler/syntax_factory.lua:9-10` and constructor rows). Syntax compile does not supply the text route's default chunk_name, so provide a meaningful string in examples; error-format concatenation directly consumes that name (`machine/bios/compiler/load.lua:27-46`; `machine/bios/compiler/semantic.lua:5-8`).

Explicit semantic failures include duplicate parameter keys (`semantic.lua:84-96`), unresolved generated-symbol keys (`semantic.lua:151-194`), path not rooted in visible binding (`semantic.lua:197-218`), assignment to const local/upvalue/external binding (`semantic.lua:267-287`), const local missing initializer (`semantic.lua:290-305`), break outside current function's loop (`semantic.lua:349-372,387-407`), non-final return within a block (`semantic.lua:374-385`), and unsupported statement/literal kinds (`semantic.lua:18-35,349-372`). Too-large register requirement raises `[load:<chunk_name>] function or expression needs too many registers` (`machine/bios/compiler/compiler.lua:1925-1946`). These paths raise directly through compile_syntax, not `nil,error`.

No general runtime DTO-style validation of factory inputs occurs. Therefore constructor availability does not promise all arbitrary argument combinations are supported. Two exact producer/consumer boundaries to document rather than fix:

1. `call_statement(expression)` stores arbitrary supplied expression (`syntax_factory.lua:195-202`), and binder accepts it as value (`semantic.lua:349-355`), but codegen unconditionally treats it as a call with `.callee`/`.arguments` (`compiler.lua:1613-1626,604-649`). Teach **call-expression input only**; no claim that `call_statement(number_literal(...))` is supported, no wrapper/fallback proposed. Owners: syntax_factory constructor, semantic statement binder, compiler statement emitter.
2. `unary_expression(syntax.unary_string_id,operand)` stores arbitrary operand (`syntax_factory.lua:154-162`), but semantic constant-folding is defined for string-literal operand only (`semantic.lua:18-35,251-264`); dynamic unary opcode table deliberately has only negate/not/length (`compiler.lua:33-37,869-884`). Teach unary_string_id with direct string-literal operand only, not arbitrary dynamic string expression. Owners: syntax_factory constructor, semantic literal handling, compiler unary opcode table. No invented encoding helper or behavior-preserving fix inferred.

## 6. Environment/external scope: only directly consumed syntax-route contract

The syntax-route signature is four arguments after aliasing: `(chunk,chunk_name,environment,external_scope)` (`machine/bios/compiler/api.lua:4-6`; `machine/bios/compiler/load.lua:27-35`). No mode parameter exists on this route.

- Compiler marks environment availability by `environment ~= nil`, stores supplied environment itself in program, and passes `external_scope and external_scope.names` to semantic binding (`machine/bios/compiler/compiler.lua:1881-1895`). Nested functions inherit those available namespaces (`machine/bios/compiler/semantic.lua:387-399`).
- Current local/parameter and enclosing lexical captures take precedence. For unresolved string name, if external names exist and contain the key, binder expects binding descriptor fields `.is_type`, `.available`, and `.is_const` (the last on assignment); type-only and unavailable locations explicitly fail. Otherwise, supplied environment gets the key; without environment, runtime global accessor is selected (`machine/bios/compiler/semantic.lua:151-187,267-287`).
- The consumer shape for external_scope is `{names=<name-keyed descriptor table>,read=<callable>,write=<callable>}`; this is a description of actual compiler accesses, **not** permission to fabricate frame descriptors or a new public frame API. Compiler adds exact descriptor and selected accessor to constant pool; emitted read invokes accessor(descriptor), emitted assignment invokes accessor(descriptor,value) (`machine/bios/compiler/compiler.lua:76-97,420-442,950-974`). Descriptor admission, full producer representation, and lifetime are intentionally unverified here and belong to debug/frame and its live consumers.
- Environment read/write operates on the stored guest table at execution (`machine/bios/compiler/compiler.lua:76-86,367-372,407-419,991-1011`); it is not a snapshot of values nor a reconstruction of the CPU global registerfile. Without explicit environment, named global reads/writes use compiler-captured `__bmsx_getglobal`/`__bmsx_setglobal`, not mutable public wrappers (`machine/bios/compiler/compiler.lua:8-12,87-96,420-442,950-974`).

## 7. Source-grounded construction sketches (not executed or runtime-validated)

These are evidence-derived illustrations of actual constructor composition, not new repo code or completed behavioral tests. They deliberately use exported factories, ordinary guest lists, and supplied syntax constants rather than host AST DTOs, token enums, bytecode words, or local literal/fixed-point encoders.

### Nested function captures a generated local, with one fresh occurrence per use

```lua
local f = lua_compiler.syntax_factory
local s = f.syntax
local counter = f.generated_symbol('counter')
local tree = f.chunk(f.block({
    f.local_statement(f.reference(counter), f.number_literal(0), false),
    f.return_statement({
        f.function_expression({ f.identifier('delta') }, f.block({
            f.assignment_statement(
                f.reference(counter),
                f.binary_expression(s.binary_add,
                    f.reference(counter), f.identifier('delta'))),
            f.return_statement({ f.reference(counter) }),
        })),
    }),
}))
local root = lua_compiler.compile_syntax(tree, '=(generated counter)')
-- `root` is compiled but not called here. Its root function has no syntax parameters.
-- Discard this occurrence tree after compilation; do not reuse it for another tree.
```

Constructor field evidence: factory inventory in section 2. Capture/binding evidence: `machine/bios/compiler/semantic.lua:68-194,387-435`. This sketch avoids implicit recursive-local assumptions because the captured declaration precedes the nested function initializer.

### Remaining compositional forms, using fresh nodes at every occurrence

```lua
-- member key is a spelling string, not f.identifier('ready'):
f.member_expression(f.identifier('device'), 'ready')
-- computed index is an expression; index_path takes raw literal values:
f.index_expression(f.identifier('items'), f.identifier('i'))
f.index_path(f.identifier('config'), { 'channels', 1, 'enabled' })
-- method callee is receiver and explicit args exclude self:
f.call_statement(f.call_expression(f.identifier('device'),
    { f.string_literal('ready'), f.boolean_literal(true) }, 'set'))
-- choose literal constructor explicitly for nil:
f.nil_literal()
f.literal(false)
-- operator enum is from f.syntax, not lexer token constants:
f.unary_expression(s.unary_not, f.identifier('ready'))
f.unary_expression(s.unary_string_id, f.string_literal('asset-name'))
-- clauses own blocks; place the unconditional source-equivalent else last:
f.if_statement({
    f.if_clause(f.identifier('ready'), f.block({})),
    f.else_clause(f.block({})),
})
f.while_statement(f.identifier('ready'), f.block({ f.break_statement() }))
f.numeric_for_statement(f.identifier('i'), f.number_literal(1),
    f.number_literal(3), nil, f.block({}))
```

These are isolated constructor-expression sketches, not statements intended to be pasted as one executable source chunk. Required list/node/string distinctions and evidence are in section 4; break scope and string-id restriction in section 5. They are not proof of runtime results.

## 8. Audit completion boundary

Syntax export inventory and its directly consumed representation/binding/codegen boundaries are COMPLETE as a source-only audit. Overall chapter evidence remains INCOMPLETE until root integrates text grammar, actual API installation/metadata, external descriptor producer/admission, physical allocation/lifetime, and any explicitly required runtime proof. No production-reference implementation or web content was needed because this task performs no implementation. No architectural fixes, ABI promises, cartridge permissions, host-compiler equivalence, or unexecuted acceptance claims are inferred.
