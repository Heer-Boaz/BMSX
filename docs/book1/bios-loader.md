# BIOS runtime compilation

`load` compiles a text chunk into a closure during program execution.
`lua_compiler.compile_syntax` accepts an owned syntax tree instead of text;
`lua_compiler.syntax_factory` supplies its constructors and syntax constants.
Neither compilation route invokes the generated chunk. This interface is
separate from cartridge module declarations and linked startup.

Use [BLua source programs](blua-programs.md) for BLua program source and
modules, [CPU values and calls](cpu.md#calls-closures-globals-and-tables) for
ordinary call/capture behavior, [Memory and program storage](memory.md) for
value storage and reserved addresses, and [Protected calls and coroutines](coroutines.md)
for the error boundary. The source forms below apply to runtime-compiled text;
they are not the complete BLua program language.

Choose text loading when the input is text authored during execution. Choose
syntax compilation when a program constructs an expression or procedure from
known operations and bindings; it avoids formatting and reparsing source text.
Both routes produce ordinary closures with the same processor call interface.
Neither route adds cartridge module linkage, static storage declarations or a
private copy of the installed BIOS environment.

An environment can supply Tables, functions and hardware access routines to
the compiled chunk. The runtime text language itself has no Table constructor,
typed storage declaration or raw mapped-memory source form. Pass the required
values through its environment or external bindings rather than assuming all
linked BLua extensions are accepted by `load`.

## Runtime compilation interface

The BIOS installs `lua_compiler` and assigns its `load` function to the global
`load` binding. Compilation produces a callable closure; it does not execute the
compiled chunk.

| Entry | Interface | Result |
|---|---|---|
| `load` or `lua_compiler.load` | `load(source, chunk_name, mode, environment, external_scope)` | Protected text compilation. |
| `lua_compiler.compile_syntax` | `compile_syntax(chunk, chunk_name, environment, external_scope)` | Direct compilation of a syntax chunk, without text parsing. |
| `lua_compiler.syntax_factory` | Syntax-construction interface | Supplies the syntax factory; its construction contract is separate from loading. |

### Text loading

`load` has five fixed parameters, in this order:

| Position | Parameter | Omission or default | Use |
|---|---|---|---|
| 1 | `source` | Missing fixed argument becomes `nil`; no source default is supplied. | Text input passed to the parser. |
| 2 | `chunk_name` | `nil` or `false` selects `"=(load)"`. | Chunk label passed to parsing and compilation. Other values, including `""` and `0`, remain supplied values. |
| 3 | `mode` | Only `nil` bypasses the mode scan and accepts text. | A supplied String must contain lowercase `t`. |
| 4 | `environment` | `nil` selects ordinary global-name routing. | A non-`nil` guest value supplies the environment-name route. |
| 5 | `external_scope` | An omitted argument becomes `nil`. | Forwarded to compilation for external-name binding. |

Mode acceptance happens first, before the chunk-name default or text parsing.
For a supplied String, the entire acceptance test is whether a lowercase `t`
occurs. This is not an exact-mode-name or allowed-character check.

| Mode | Effect |
|---|---|
| `nil` | Accept text without scanning. |
| `"t"`, `"bt"`, or another String containing `t` | Accept and parse text. |
| `""` or `"b"` | Reject before parsing. |

Acceptance never selects a binary decoder. The scan uses one-based String
codepoint positions, not UTF-8 byte offsets. Non-String values encounter the same
length and String-codepoint operations, not a separate mode-type validator. A
Table supplies its maintained length to the length operation. In particular,
`false` reaches a length failure before parsing, with the reason String
`"Attempted to get length of an unsupported value."`.

A rejected mode calls the current global `error` with
`"attempt to load a text chunk (mode is '" .. mode .. "')"`.
This describes the error value passed to that call, not a display prefix or
stack-trace format.

### Results and execution

| Outcome | Exact returned values |
|---|---|
| Successful compilation | One value: the compiled closure. |
| Failure returned through the protected boundary | Two values: `nil, errorValue`. |

`load` retains only the protected call's first result after its success flag.
It does not normalize every failure into a String. An explicitly thrown guest
value is preserved, so `errorValue` can itself be `false` or `nil`. Classified
execution and out-of-memory failures supply a reason String. Use the first
result to distinguish a closure from failure; do not require the error value to
be truthy or non-`nil`.

The protected result convention applies to language errors, not hardware
exceptions. It leaves earlier writes in place. An intervening hardware
exception or interrupt also prevents protection from unwinding across that
boundary; hardware-access and opcode faults do not become a
`nil, errorValue` pair.

Program in this order:

1. Select the text source, chunk label, mode, and any environment or external
   scope.
2. Call `load` with those arguments and retain its first and second results.
3. If the first result is `nil`, handle the second value as the failure payload,
   including a possible `nil` payload.
4. Otherwise, invoke the returned closure explicitly when execution is wanted.

### Name binding and retained dependencies

Local, parameter, and upvalue bindings take precedence. For a name not resolved
there, compilation selects external-scope metadata first, then the environment
route when `environment ~= nil`, otherwise the global-name route.

Generated environment-name accesses retain the supplied guest value, not a
copied set of globals. Environment-name reads and writes perform indexed operations
directly against that value. `false` is a supplied environment, not an omission:
it selects this route too. The loader does not add an environment-type check.
Without an environment, generated global accesses use retained global-accessor
function values and textual keys. Reassigning public `getglobal` or `setglobal`
does not replace those retained dependencies.

The initial global `load` and `lua_compiler.load` bindings contain the same
function value. Later assignment to one does not reassign the other. The loader
also retains its protected-call primitive, so replacing public `pcall` does not
replace that dependency. Each call looks up the compile entry on the compiler
Table retained by the loader; it does not dispatch through the current global
`load` or public `lua_compiler.load` binding. Mode scanning uses a retained
String-codepoint primitive, while mode rejection uses the current global
`error` binding.

### Direct syntax compilation

`lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)`
is a direct function-value alias for syntax-chunk compilation. It produces a
closure without invoking it. Unlike `load`, this route does not perform a mode
check, parse text, supply the `"=(load)"` chunk-name default, or convert a
protected failure into `nil, errorValue`. It has four fixed parameters; omitted
fixed arguments become `nil`.

### Written calls and reached calls

The published source-call signatures and the reached functions differ in one
specific respect:

| Published source-call signature | Required written expressions | Actual fixed parameters |
|---|---:|---:|
| `load(chunk, chunkname?, mode?, env?)` | 1 | 5, including `external_scope` |
| `lua_compiler.compile_syntax(chunk, chunkname, env?)` | 2 | 4, including `external_scope` |

For recognized calls, this source-call check rejects a written expression count
below the required count; it does not impose a maximum. The omitted
`external_scope` entry is not a runtime argument limit. A reached call fills
missing fixed parameters with `nil` and does not retain surplus arguments in
these non-vararg functions. That runtime behavior does not establish permission
for every shortened source call or general source-input acceptance.

### Compilation work

The retained protected-call primitive has a base charge of **4 cycles**, with
zero additional primitive charge per argument or return value. This is an
incremental protected-call charge, not the duration of `load`. It excludes the
loader's own execution, mode scanning, parsing, semantic analysis, code
generation, linking, allocations, callees, instruction reads and writes, and
caller call/return work. No fixed total compilation time follows from it.

## Runtime-loaded source language

`load` accepts the source forms in this section. Its input is an executable block, not a list of declarations: statements and a final `return` may appear at the top level. Compiling the block produces a function; it does not execute the block.

This language is narrower than BLua. A source file accepted for linking is not necessarily accepted by `load`.

### Names, spacing, and comments

| Element | Runtime source form |
| --- | --- |
| Name | First character: ASCII `a`–`z`, `_`, or `$`. Later characters may also be decimal digits. Uppercase letters are not permitted in names. |
| Whitespace | Space and character codes 9 through 13. |
| Line comment | `--` through the next LF or the end of the source. |
| Statement separator | `;` is optional and may also appear as an empty separator. |

There are no long comments or long quoted strings. LF advances the source line; other whitespace does not. String positions and lengths use codepoints, not UTF-8 byte offsets.

### Numeric literals

| Form | Examples and requirements |
| --- | --- |
| Decimal integer | `0`, `27`, `1234` |
| Decimal fraction | `12.5`, `.5`; a fractional dot must be followed by a digit. |
| Decimal exponent | `1e3`, `2.5E-2`; `e` or `E` may be followed by a sign, then must have decimal digits. |
| Hexadecimal integer | `0x2a`, `0X2A`; at least one hexadecimal digit is required. |

A leading sign is an operator, not part of the numeric literal. These spellings do not specify additional numeric range or rounding guarantees.

### Quoted strings

Use single or double quotes. An unescaped CR, LF, or end of source before the closing quote is an unfinished string.

| Escape | Meaning or accepted form |
| --- | --- |
| `\'`, `\"`, `\\` | Quote or backslash. |
| `\a`, `\b`, `\f` | Alert, backspace, form feed. |
| `\n`, `\r`, `\t`, `\v` | Newline, carriage return, tab, vertical tab. |
| Decimal escape | Backslash followed by up to three decimal digits; the value must not exceed 255. |
| Hexadecimal escape | `\x` followed by exactly two hexadecimal digits. |
| `\z` | Skip subsequent whitespace. |

### Expressions and suffixes

| Primary expression | Form |
| --- | --- |
| Name | `name` |
| Literal | Number, quoted string, `false`, `true`, or `nil` |
| Anonymous function | `function(parameter, ...) ... end`; the displayed ellipsis means more named parameters, not a vararg token. |
| Parenthesized expression | `(expression)` |

Function parameters are zero or more comma-separated names. Duplicate names within one function's parameter list are rejected. There is no vararg parameter or vararg expression.

Suffixes may be chained after a primary expression:

| Suffix | Form |
| --- | --- |
| Named member | `.name` |
| Indexed member | `[expression]` |
| Ordinary call | `(argument, ...)` |
| Method call | `:name(argument, ...)` |

Calls require parentheses, including calls with no arguments. The commas in a call separate zero or more expressions.

A member/index path must begin at a visible name. Thus `items[index].value` has the required shape, but `make_items().value` does not: a member or index path cannot begin at a call result, literal, or function expression. This restriction does not by itself exclude `make_items():method()`, whose receiver belongs to a method call rather than a member/index path.

### Operators

Unary operators bind more tightly than the binary operators below.

| Unary form | Operation |
| --- | --- |
| `-expression` | Negation |
| `not expression` | Logical negation |
| `#expression` | Length |
| `&expression` | String-ID form. Evaluate the operand once as one value and retain its String value unchanged. The result is not a numeric address or pointer; literals, variables, indexed values and calls can supply the String. |

<div class="keep-together">

Binary precedence is listed from highest to lowest. Every row is left-associative.

| Precedence | Operators |
| --- | --- |
| 1 | `*`, `/`, `//`, `%` |
| 2 | `+`, `-` |
| 3 | `&` |
| 4 | `==`, `~=`, `<`, `<=`, `>`, `>=` |
| 5 | `and` |
| 6 | `or` |

</div>

Parentheses override binary precedence. The unary String-ID form and binary `&` occupy different expression positions.

### Statements

The following forms are available in a block. In these forms, `block` means a sequence of statements, and bracketed text denotes optional source.

| Statement | Form |
| --- | --- |
| Local | `local name [<const>] [= expression]` |
| Assignment | `target = expression` |
| Call statement | An ordinary call or method call. |
| Return | `return` or `return expression [, expression ...]` |

An assignment has exactly one target and one value expression. Its target is a name or a member/index path. A bare expression that is neither an assignment nor a call is not a statement.

| Control statement | Form |
| --- | --- |
| Conditional | `if expression then block [elseif expression then block ...] [else block] end` |
| While loop | `while expression do block end` |
| Numeric loop | `for name = start, limit [, step] do block end` |
| Loop exit | `break` |

The numeric loop evaluates its start, limit, and supplied step expressions into loop locals. An omitted step is `1`. `break` must be inside a loop in the current function; a function nested inside a loop does not inherit permission to break that loop.

A `return` must be the final non-semicolon statement of its immediate block. It need not be the final statement of an enclosing block: for example, an `if` branch may end in `return` while the containing block continues after the `if`.

### Locals, closures, and names

| Rule | Effect |
| --- | --- |
| Uninitialized local | `local name` initializes the local to `nil`. |
| Constant local | `local name <const> = expression` requires an initializer. `const` is the only accepted local attribute. |
| Constant assignment | Direct reassignment to a constant binding is rejected, including a captured constant or constant supplied binding. Member/index writes through that binding are not prohibited by this rule. |
| Initializer scope | The initializer is bound before the new local becomes visible. |
| Block scope | Leaving a block restores any previous same-name local binding. |
| Closure capture | An anonymous function captures visible enclosing local or parameter bindings. |

For recursive local functions, declare the local before assigning the function:

```lua
local f
f = function()
  return f()
end
```

By contrast, in `local f = function() return f() end`, the `f` inside the function does not denote the local being introduced by that declaration.

Names resolve in this order:

| Priority | Binding |
| --- | --- |
| 1 | Active local or parameter. |
| 2 | Captured enclosing local or parameter. |
| 3 | A supplied external binding. |
| 4 | A key in the supplied environment, or a global name when no environment is supplied. |

An absent external name continues to environment/global lookup; it is not automatically an unknown-name error. A supplied external entry that represents a struct type is not a runtime value, and an unavailable external entry has no live location. Ordinary source names such as `_env` do not independently change this lookup order.

<div class="keep-together">

### Calls and results

An ordinary call evaluates its callee before evaluating its arguments. A method call evaluates its receiver once, uses it as `self`, selects the named method, and then evaluates the explicit arguments in order.

| Context | Result handling |
| --- | --- |
| Ordinary value expression | A call supplies one result. |
| Final argument expression | An unparenthesized call expands its result tuple into arguments. |
| Earlier argument expression | A call supplies one result. |
| Final return expression | An unparenthesized call forwards its result tuple after any preceding return values. |
| Earlier return expression | A call supplies one result. |
| Parenthesized call | Does not expand its result tuple. |
| Bare `return` | Returns one `nil` result. |
| Function fallthrough | Returns one `nil` result. |

</div>

For example, `return a, f()` forwards the results of `f` after `a`; `return a, (f())` uses one result from `f`. Likewise, `g(a, f())` expands the final call, while `g(a, (f()))` does not.

### BLua program forms are not runtime-loaded forms

| BLua program form | Runtime-loaded distinction |
| --- | --- |
| `module<const>`, `module<entry>` | No module-directive form. These spellings are ordinary names and comparison tokens, not directives. |
| `struct`, `bss`, `data`, `rodata` declarations | No corresponding declaration or type-reference syntax. |
| Pointer annotations such as `:*type` | Not part of the local declaration form. |
| Multiple local names or assignment targets | One local name, or one assignment target and one value expression. |
| `local function name(...) ... end` | Use a local declaration and an anonymous function expression. |
| `function name(...) ... end` | No named-function statement; `function` must be followed by `(`. |
| Local-function `<init>` | Not an accepted local-function form. |

| Other BLua program form | Runtime-loaded distinction |
| --- | --- |
| Generic `for` | Only the numeric `for name = ...` form is available. |
| `repeat` loop | No repeat-loop statement. |
| Standalone `do ... end` | No standalone block statement. |
| `goto` | No goto statement. |
| Halt-until-interrupt statement | No corresponding runtime-loaded statement. |
| Table constructor | No `{ ... }` expression. |
| Varargs | No `...` parameter or expression; dots are separate punctuation. |

The absence of a statement form does not reserve every associated spelling as a keyword. For example, `repeat` may be used as an ordinary name in runtime-loaded source.

### Source diagnostics

Lexical and parse diagnostics use `[load:<chunk_name>] <message> at <line>:<column>`. Representative messages include `upper-case identifiers are not allowed`, `unfinished string`, `invalid numeric literal exponent`, `expected '<token name>'`, `unsupported expression`, and `expected assignment or function call`.

The whole block is parsed before binding and compilation. Binding also rejects a misplaced `return`, `break` outside a loop, missing constant initializers, direct assignment to constants, duplicate function parameters, and member/index paths without a visible-name root. A function or expression requiring too many registers is rejected with `[load:<chunk_name>] function or expression needs too many registers`, without a source position appended by that diagnostic.

## Constructing and compiling syntax trees

The installed `lua_compiler.syntax_factory` table constructs runtime syntax nodes. Its `syntax` member contains the numeric node tags and operator constants used by those nodes. There is no separate installed syntax global.

```lua
local f = lua_compiler.syntax_factory
local s = f.syntax
```

<div class="keep-together">

Use the factory to construct a complete chunk, then compile it:

```lua
lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)
```

| Argument | Meaning |
|---|---|
| `chunk` | A chunk node whose `body` is a block node. |
| `chunk_name` | Diagnostic name. Supply a meaningful string; this entry point supplies no default name. |
| `environment` | Optional environment value; normally a Table for name indexing. Omitted or `nil` selects ordinary global-name access. |
| `external_scope` | Optional external-name access interface, described below. |

</div>

Successful compilation returns **one root callable closure**. It does not call that closure. The root has no syntax parameters. Compilation binds and compiles every nested function and links the resulting program; it skips text parsing, not the remaining compilation work. There is no `mode` argument on this entry point. Compilation errors raise directly: this is not an interface returning `nil, message` on failure.

### Node ownership, lists, and locations

Each constructor or helper returns one value. Constructors store the supplied children, lists, values, and symbol keys directly; they do not clone them or supply default arguments.

Every tagged node has `kind`, `line = 1`, and `column = 1`, in addition to the fields listed in the reference below. The helper records returned by `generated_symbol`, `if_clause`, and `else_clause` are untagged and have no location fields.

A node is an **owned syntax occurrence**. Construct a fresh node for every declaration, reference, expression, and statement occurrence. Do not put the same node into multiple positions or trees. Share a generated-symbol key when several occurrences must name the same binding, not the identifier node carrying that key.

Binding and compilation annotate nodes in place. Do not recompile an already annotated tree, retain its nodes for another tree, or retry a failed compilation with the same tree. Failure can occur after annotations have been written. Construct a fresh tree for each compilation attempt.

All lists in this interface are ordinary consecutive, 1-based guest Tables. They are consumed through `#list` and `list[index]`; a packed table's `.n` field has no role. Pass `{}` for an empty statement, parameter, argument, return-expression, or clause list. There are no default empty lists or hole-filling rules.

### Chunk, blocks, names, and literals

The names below are members of `lua_compiler.syntax_factory`.

| Callable signature | Returned fields beyond the common location fields |
|---|---|
| `chunk(body)` | `kind = s.chunk`, `body`. |
| `block(statements)` | `kind = s.block`, `statements`. |
| `identifier(name)` | `kind = s.identifier_expression`, `name`. |
| `generated_symbol(name)` | Untagged `{ name = name }` record; no common node fields. |
| `reference(symbol)` | `kind = s.identifier_expression`, `name = symbol`. |

`chunk.body` must be a block node. `block.statements` is a statement-node list. A function body and every conditional or loop block also use a block node, not a raw statement list.

`identifier('x')` creates an occurrence using the spelling string `'x'` as its lexical key. `generated_symbol('x')` creates a distinct table key whose name is used for diagnostic spelling. Two generated symbols with the same display name remain different keys. `reference(symbol)` creates an occurrence carrying the exact supplied symbol key.

| Callable signature | Returned fields beyond the common location fields |
|---|---|
| `number_literal(value)` | `kind = s.number_literal_expression`, `value`. |
| `string_literal(value)` | `kind = s.string_literal_expression`, `value`. |
| `boolean_literal(value)` | `kind = s.boolean_literal_expression`, `value`. |
| `nil_literal()` | `kind = s.nil_literal_expression`; no value field. |
| `literal(value)` | Selects the number, string, or boolean constructor according to `type(value)`. |

Supply the corresponding guest value to each literal constructor. Number and string values become program constants or compiler-selected numeric immediates. Boolean emission uses the guest truth value of the stored value. `literal(nil)` is **not** equivalent to `nil_literal()`: the dispatch has no nil entry and raises during construction. Tables and functions are also outside `literal`'s dispatch. Use `nil_literal()` to construct nil.

### Paths, calls, operators, and functions

| Callable signature | Returned fields beyond the common location fields |
|---|---|
| `member_expression(base, identifier)` | `kind = s.member_expression`, `base`, `identifier`. |
| `index_expression(base, index)` | `kind = s.index_expression`, `base`, `index`. |
| `index_path(base, path)` | Nested index nodes; each path value is passed through `literal`. An empty path returns the original `base`. |
| `call_expression(callee, arguments, method_name)` | `kind = s.call_expression`, `expands_results = true`, `callee`, `arguments`, `method_name`. |
| `binary_expression(operator, left, right)` | `kind = s.binary_expression`, `operator`, `left`, `right`. |
| `unary_expression(operator, operand)` | `kind = s.unary_expression`, `operator`, `operand`. |
| `function_expression(parameters, body)` | `kind = s.function_expression`, `parameters`, `body`. |

The `identifier` argument of `member_expression` is the **member key itself**, normally a spelling string such as `'ready'`; it is not an identifier node. The `index` argument of `index_expression` is an expression node. A nonconstant index is evaluated at execution; a constant index supplies its constant key.

Member and index bases must form an identifier-rooted path, recursively composed of identifier, member, and index nodes. An arbitrary call or other expression is not a supported path base. `index_path` takes a list of raw number, string, or boolean values, not expression nodes.

For an ordinary call, omit `method_name` or pass `nil`; `callee` is the callable expression. For a method call, `callee` is the **receiver expression**, not an already selected member, and `method_name` is the method key, normally its spelling string. `arguments` is an expression-node list. Do not include the receiver as its first explicit argument: the method form supplies the implicit receiver argument itself. Use `{}` for no explicit arguments.

Unary and binary operators are the numeric constants in `f.syntax`, not source spelling strings, token numbers, or instruction words. `s.unary_string_id` accepts a String-valued expression node. Its operand is evaluated once as one value; a call's additional results are discarded. The result is the same String value, not a numeric pointer or raw address.

A function's `parameters` is a list of **identifier occurrence nodes**, not strings. Its `body` is a block node. Every parameter needs its own occurrence. A generated-symbol parameter is represented with a fresh `reference(symbol)` just like a generated-symbol local declaration.

### Assignments, declarations, calls, and conditionals

| Callable signature | Returned fields beyond the common location fields |
|---|---|
| `assignment_statement(target, value)` | `kind = s.assignment_statement`, `target`, `value`. |
| `local_statement(name, initializer, is_const)` | `kind = s.local_statement`, `name`, `initializer`, `is_const`. |
| `call_statement(expression)` | `kind = s.call_statement`, `expression`. |
| `if_clause(condition, block)` | Untagged `{ condition = condition, block = block }` record; no common node fields. |
| `else_clause(block)` | Untagged `{ block = block }` record; no common node fields. |
| `if_statement(clauses)` | `kind = s.if_statement`, `clauses`. |

`assignment_statement` represents one target and one value expression, **not parallel lists**. Identifier targets use identifier occurrence nodes; member and index targets follow the path rules above. Assignment cannot change a const local, captured const binding, or const external binding.

The `name` of `local_statement` is an **identifier occurrence node**, not a spelling string or a bare generated-symbol record. Use `identifier('x')` or a fresh `reference(symbol)`. An omitted or nil initializer initializes a mutable local to nil. Omitted, nil, or false `is_const` leaves the local mutable; a truthy `is_const` requires an initializer.

The initializer is bound **before** the new local is declared. A same-spelling reference in that initializer resolves to the previously visible binding, not automatically to the local being declared. This constructor does not provide an implicit recursive-local declaration.

`call_statement` requires a **call-expression node** as its `expression`. It is not a general expression-statement constructor.

`if_statement.clauses` is a list of the untagged records made by `if_clause` and `else_clause`. A missing or nil `condition` means unconditional. Each clause's `block` is a block node. Put the unconditional else clause last when constructing an ordinary if/elseif/else sequence.

<div class="keep-together">

### Loops and returns

The numeric-loop signature is shown separately to keep its argument positions visible:

```lua
numeric_for_statement(
    variable,
    start_expression,
    limit_expression,
    step_expression,
    block
)
```

It returns a node with `kind = s.numeric_for_statement`, the common location fields, and the five fields named by its arguments. `variable` is an identifier occurrence node, not a string. Start, limit, and a supplied step are expression nodes; `block` is a block node. A nil step selects positive one. To omit the step, pass `nil` in the **fourth** position and the block in the fifth. Variable, start, limit, and block are required.

</div>

| Callable signature | Returned fields beyond the common location fields |
|---|---|
| `while_statement(condition, block)` | `kind = s.while_statement`, `condition`, `block`. |
| `return_statement(expressions)` | `kind = s.return_statement`, `expressions`. |
| `break_statement()` | `kind = s.break_statement`. |

A while condition is an expression node and its body is a block node. A break must be inside a loop in the **same function**; an enclosing function's loop does not make a nested function's break valid. A return must be the final statement of its block. Its `expressions` argument is an expression-node list, with `{}` representing an empty return.

### Result counts

All 27 factory callables return one value. `compile_syntax` also returns exactly one value on success: the compiled root closure. Those return counts are distinct from the result counts of calls represented inside the tree.

| Constructed use | Result handling |
|---|---|
| Call used in a single-value expression position | Requests one result. |
| Call statement | Requests one result internally, then discards its temporary expression storage; the statement returns no language value. |
| Final argument of another call | Expands the call's result tuple only when the final node is a call expression with truthy `expands_results`. |
| Final expression of a return list | Uses the same call-kind and `expands_results` rule for tuple expansion. |
| Fixed return list without a final expanding call | Returns its expression count. |
| Empty return, or function fallthrough | Returns **one nil value**. |

`call_expression` sets `expands_results = true`. To represent a final call restricted to one result, set that owned call node's **existing** `expands_results` field to `false` before compilation. There is no separate factory callable for this operation. It does not require a replacement node format or encoding helper.

### Lexical names and captured bindings

Ordinary spelling strings obey lexical shadowing. Generated-symbol occurrences match the exact shared symbol key; their display names do not establish identity. Use a separate fresh occurrence for the declaration and every later reference.

Name resolution considers current locals and parameters, then visible enclosing bindings, which nested functions capture as upvalues. An unresolved **string** key then tries external names and finally the supplied environment or ordinary global access. An unresolved generated-symbol key raises instead of becoming a global.

Nested functions inherit access to the supplied environment and external names. They do not acquire arbitrary locals from the BLua function that called `compile_syntax`. The synthetic root has no enclosing lexical function and an empty parameter list.

### Environment and external-name access

Every non-nil `environment` selects environment-name access. Generated reads and writes index the supplied value at execution; there is no environment-type check or snapshot of its entries. Without an explicit environment, named global access uses the compiler's captured global accessors, not mutable public replacement functions.

The consumed external access interface has this shape:

```lua
external_scope = {
    names = name_keyed_descriptors,
    read = read_binding,
    write = write_binding,
}
```

Each name maps to a descriptor Table. The fields below control binding;
additional fields can hold the location data needed by that descriptor's
read and write callbacks.

| Member or descriptor field | Consumed meaning |
|---|---|
| `external_scope.names` | Table mapping unresolved spelling strings to their exact binding descriptors. |
| `descriptor.is_type` | A type-only descriptor cannot be used as a value binding. |
| `descriptor.available` | An unavailable external location cannot be used. |
| `descriptor.is_const` | A truthy value prevents assignment to that binding. |
| `external_scope.read` | Access callback selected for an external read. |
| `external_scope.write` | Access callback selected for an external assignment. |

A compiled external read calls:

```lua
read_binding(descriptor)
```

A compiled external assignment calls:

```lua
write_binding(descriptor, value)
```

The descriptor is the exact object selected from `names`; it is not reconstructed. Compilation retains that descriptor and the selected callback for the generated access. These callbacks run when the compiled code performs the access, not as a name-lookup substitute during binding.

Local, parameter, and enclosing lexical bindings take precedence over an external descriptor with the same spelling. A matching external entry is checked for type-only and unavailable status; it does not silently fall through to the environment when unusable. Without a matching external name, the environment or ordinary global route is selected. Const checking also applies to external assignment.

<div class="keep-together">

### Exported node constants

All constants below are members of `f.syntax`. Node kinds and operators occupy overlapping integer ranges; the field using a value determines its category. No token table is exported by the factory.

| Node constant | Value |
|---|---:|
| `chunk` | 1 |
| `block` | 2 |
| `assignment_statement` | 3 |
| `return_statement` | 4 |
| `function_expression` | 5 |
| `identifier_expression` | 6 |
| `member_expression` | 7 |

</div>

| Node constant | Value |
|---|---:|
| `index_expression` | 8 |
| `number_literal_expression` | 9 |
| `string_literal_expression` | 10 |
| `boolean_literal_expression` | 11 |
| `nil_literal_expression` | 12 |
| `unary_expression` | 13 |
| `binary_expression` | 14 |

| Node constant | Value |
|---|---:|
| `call_expression` | 15 |
| `local_statement` | 16 |
| `if_statement` | 17 |
| `while_statement` | 18 |
| `break_statement` | 19 |
| `call_statement` | 20 |
| `numeric_for_statement` | 21 |

### Exported unary operators

| Operator constant | Value | Category |
|---|---:|---|
| `unary_negate` | 1 | Numeric negation. |
| `unary_string_id` | 2 | String-ID form; retains the operand's String value. |
| `unary_not` | 3 | Logical negation. |
| `unary_length` | 4 | Length. |

### Exported binary operators

| Arithmetic operator constant | Value |
|---|---:|
| `binary_add` | 1 |
| `binary_subtract` | 2 |
| `binary_multiply` | 3 |
| `binary_divide` | 4 |
| `binary_floor_divide` | 5 |
| `binary_modulus` | 6 |

| Comparison operator constant | Value |
|---|---:|
| `binary_equal` | 7 |
| `binary_not_equal` | 8 |
| `binary_less` | 9 |
| `binary_less_equal` | 10 |
| `binary_greater` | 11 |
| `binary_greater_equal` | 12 |

| Logical or bitwise operator constant | Value | Category |
|---|---:|---|
| `binary_and` | 13 | Logical. |
| `binary_or` | 14 | Logical. |
| `binary_bitwise_and` | 15 | Bitwise. |

The exported tables are ordinary tables, but changing compiler constants is not a supported customization mechanism.

### Errors and compiler-owned fields

Semantic diagnostics use this form:

```text
[load:<chunk_name>] <message> at <line>:<column>
```

Fresh factory nodes therefore report location `1:1`. Supplying a diagnostic chunk name is important: this route does not fill one in before error formatting.

<div class="keep-together">

The following conditions explicitly raise during binding:

| Condition | Rule |
|---|---|
| Duplicate parameter keys | Parameter binding keys must be distinct. |
| Unresolved generated-symbol key | A generated symbol must resolve lexically. |
| Invalid member/index path root | A path must have a supported visible identifier root. |
| Assignment to a const binding | Applies to locals, captured bindings, and external bindings. |
| Const local without initializer | A const declaration needs an initializer. |
| Break outside a loop of the current function | Nested functions start with no loop context. |

</div>

| Condition | Rule |
|---|---|
| Non-final return in a block | A return must end its block. |
| Unsupported statement or literal kind | Only supported kinds can be compiled. |
| Type-only external entry used as a value | The descriptor is not a value binding. |
| Unavailable external entry | Its location cannot be used. |

Excessive register requirements raise:

```text
[load:<chunk_name>] function or expression needs too many registers
```

Invalid `literal` dispatch raises during tree construction, before `compile_syntax` is called. Supply the node and argument forms listed in the factory tables, including
the call-statement and String operand restrictions. Incorrect node shapes
can fail at a later binding or emission operation rather than at construction.

<div class="keep-together">

Supply constructor inputs rather than precomputed compilation annotations. Compiler-owned fields include:

| Area | Fields written by compilation |
|---|---|
| Name binding | `binding`, `upvalue`, `external_binding`, `environment_key`, `global_key`. |
| Paths and constants | `key_value`, `constant_value`, `constant_index`, `accessor_constant_index`, `immediate_index`, `method_constant_index`, `immediate_number`. |
| Numeric loops | `limit_local_slot`, `step_local_slot`, `zero_constant_index`. |
| Functions | `semantic_state`, `local_count`, `function_address_constant_index`. |

</div>

Those annotations are another reason to keep syntax occurrences private to one compilation and construct a new tree after any success or failure.

## Runtime-compiled code: storage, ownership and lifetime

Runtime-compiled procedures occupy the BIOS code arena in main RAM. One
compilation places its root procedure, nested procedures, capture descriptors
and instructions in one block. Closures retain the block and its associated
constant Table while the code remains in use.

### Storage limits

| Property | Specification |
| --- | --- |
| Arena capacity | `0x00040000` bytes (256 KiB) declared storage. The usable span is its 16-byte-aligned interior, not a guaranteed 256 KiB of payload. |
| Allocation alignment | 16 bytes. |
| Allocation header | 16 bytes per allocation. |
| Allocation size | Header plus linked payload, rounded upward to a multiple of 16 bytes. An unsplittable remainder is consumed by the allocation. |
| Minimum split remainder | 32 bytes: one header plus one alignment unit. Smaller remainders do not become separate free blocks. |
| Allocation contents | All functions, capture metadata, and instruction streams from one compilation share one block. Constant-pool tables and closures use the separate guest-object heap. |
| Final arena-exhaustion error | `runtime compiler memory exhausted` |

The arena belongs to the [firmware RAM reservation](memory.md#reserved-and-cartridge-storage-in-main-ram).
The capacity above is shared by live compilations; use the separate language
allocation budget for Tables, closures and other language objects.

### Resource accounting

| Linked payload item | Bytes per item | Count |
| --- | --- | --- |
| Generated function record | 32 | F: root and nested generated functions. |
| Capture descriptor | 4 | D: actual emitted descriptors, including compiler-required captures. |
| Instruction word | 4 | W: actual emitted instruction words. |

Reference arithmetic, not BLua source:

**Payload bytes = 32F + 4D + 4W.**\
**Block bytes before an unsplittable remainder = 16 × ⌈(16 + payload bytes) / 16⌉.**

These are emitted counts, not counts of user locals or source statements. The block calculation includes the 16-byte header and allocation rounding; a remainder smaller than 32 bytes is additionally consumed rather than split off.

Each generated function has a ceiling of **16,384 total register slots**. This total includes required constants, the allocation owner where present, and temporaries. It is not a guarantee of 16,384 user locals or parameters, nor that every smaller programme will compile. Exceeding the ceiling raises:

```
[load:<chunk_name>] function or expression needs too many registers
```

### What keeps compiled code alive

The root closure retains the compilation's constant-pool table, which owns the code allocation. That reference remains valid after the loader returns.

Every child closure also retains the allocation owner, in addition to its required captures. An escaping child therefore keeps the entire compilation's code block alive, even if the root closure is no longer reachable or the child needs only some of the compilation's constants. Individual functions within that block are not reclaimed separately.

Keep a closure reachable while its compiled code is needed. Once all
references retaining that compilation become unreachable, collection makes
its block reusable. A raw function address does not retain the block. Release
language references rather than attempting to free a code block explicitly;
reclamation occurs during collection, not at the assignment that drops a
reference.

### Environments and borrowed bindings

When a compiled identifier requires an environment lookup, the constant pool retains the actual supplied environment value and the key. This is not a private copy of the environment. Supplying an environment that is never added to the constant pool does not guarantee that compilation will retain it.

An external binding retains its location and read/write accessors, not a copied binding value. Keeping those accessors alive does not extend the lifetime of a borrowed frame.

For evaluation against a selected console frame, the binding accessors borrow that frame. The evaluator closes the binding scope before returning its result, including when the result contains an escaping closure. A later read or write through a retired accessor raises:

```
Selected frame evaluation has ended.
```

Closing a coroutine also retires its borrowed frame scopes. Code retention and binding validity are separate: a surviving closure can retain its compiled code while access to a borrowed binding has already ended.

### Allocation, collection, and failure

Allocation first tries the current candidate block. If that cannot satisfy the request, it scans the arena and combines adjacent reusable blocks, stopping at the first sufficiently large run. If that search fails, allocation performs synchronous garbage collection and makes one further scan with coalescing. Failure of that retry raises `runtime compiler memory exhausted`.

A load may perform collection before it returns. The second unsuccessful
arena search raises the exhaustion error. Reserve compilation for a point
where its variable parsing, allocation and collection time can be accepted.

The [language allocation budget](cpu.md#language-allocation-and-lifetime) is
accounted for separately and can also be exhausted. Available language-object
capacity does not guarantee a suitable code block, and available code-arena
capacity does not guarantee space for closures or constant-pool Tables.

### System startup and compiled-code storage

Normal BIOS startup initializes its DATA and BSS, then prepares the runtime
code arena before program entry. Starting a program's own DATA and BSS leaves
that BIOS arena in place. Keep program sections outside firmware-reserved RAM.

A system reboot clears the execution environment and starts BIOS
initialization again. A CPU-only restart or a transfer with `EXEC` has a
different state boundary; see [CPU execution control](cpu.md#exec) and
[System control](system.md). System reboot begins a new runtime-compilation lifetime.

<a id="complete-program-runtime-compilation"></a>

## Programming runtime compilation

### Compile first, invoke explicitly

The installed environment supplies `load`. Compiling the first chunk below
leaves `environment.total` at zero; only its invocations change the field.

```lua
local environment = { total = 0, step = 3 }
local chunk, message = load(
    'total = total + step return total', 'counter', 't', environment)
if chunk == nil then
    error(message)
end
local first = chunk()
environment.step = 5
local second = chunk()
```

`first` is 3 and `second` is 8. The same closure accesses the same environment;
compilation did not copy its fields. Compare the first result with `nil` to
recognize failure: the second result can be any error payload, including nil.
Calling the closure is a separate operation with its own error boundary.

### Bind an external location

An external descriptor takes precedence over an environment field of the same
name. Its callbacks access the supplied location rather than a captured copy:

```lua
local binding = { available = true, is_type = false, is_const = false,
    value = 10 }
local environment = { external_value = 1000, step = 2 }
local chunk, message = load(
    'external_value = external_value + step return external_value',
    'external', 't', environment, {
        names = { external_value = binding },
        read = function(location) return location.value end,
        write = function(location, value) location.value = value end,
    })
if chunk == nil then
    error(message)
end
local first, second = chunk(), chunk()
```

The calls return 12 and 14; `binding.value` becomes 14 while
`environment.external_value` remains 1000. `step` has no external descriptor
and uses the environment. These descriptors own ordinary storage. Accessors
borrowing a selected frame instead expire when that evaluation scope closes,
even if a returned closure retains its code.

### Retain an escaping child

```lua
local environment = { offset = 10 }
local factory, message = load(
    'return function(value) return value + offset end',
    'capture', 't', environment)
if factory == nil then
    error(message)
end
local child = factory()
factory = nil
local first = child(5)
environment.offset = 20
local second = child(5)
```

The results are 15 and 25. Keeping the child retains the compilation's code
allocation after the factory reference is dropped. It does not freeze the
environment or promise when an unreachable allocation will be reclaimed.

### Construct syntax without parsing text

Use the installed factory so each syntax occurrence has its own node:

```lua
local factory = lua_compiler.syntax_factory
local syntax = factory.syntax
local chunk = lua_compiler.compile_syntax(
    factory.chunk(factory.block({
        factory.return_statement({
            factory.binary_expression(syntax.binary_multiply,
                factory.number_literal(6), factory.number_literal(7)),
        }),
    })), 'syntax')
local result = chunk()
```

`result` is 42. `compile_syntax` has no load-style returned-error wrapper; use
`pcall(lua_compiler.compile_syntax, ...)` when a protected result is required.
A generated symbol can be shared as a key, but its declarations and each use
must be separate syntax nodes. The [factory reference](#constructing-and-compiling-syntax-trees)
specifies constructors, node ownership, result counts and diagnostics.
