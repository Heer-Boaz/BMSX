# BIOS runtime compilation {#sec-bios-loader}

The BIOS can compile code while the program runs: from text, or from a syntax
tree built with a factory. The result is a closure, which the program calls when
it needs it, as often as needed.

| Input | Function |
|---|---|
| Text | `load` or `lua_compiler.load` |
| Syntax tree | `lua_compiler.compile_syntax`, with the tree built by `lua_compiler.syntax_factory` |

The [language of runtime-compiled text](#sec-bios-loader-runtime-loaded-source-language)
is a subset of BLua: statements and expressions, without module and storage
declarations. Tables, functions and device routines are made available through
an environment or external names. Program images are described in the
[BLua program reference](blua-programs.md#sec-blua-programs).

## Programming {#sec-bios-loader-programming-runtime-compilation}

### Compiling and calling {#sec-bios-loader-compile-first-invoke-explicitly}

```lua
local environment = { total = 0, step = 3 }
local chunk, message = load(
    'total = total + step return total', 'counter', 't', environment)
if chunk == nil then
    error(message)
end
local first = chunk()       -- 3
environment.step = 5
local second = chunk()      -- 8
```

Compiling does not execute the code: `environment.total` is still 0 after
`load`. The code uses the environment table itself, so a change to it is seen at
the next call. Test the first result for nil to detect an error; the error value
itself may be nil.

### Building a syntax tree {#sec-bios-loader-construct-syntax-without-parsing-text}

`return 6 * 7` as a syntax tree:

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
local result = chunk()      -- 42
```

`compile_syntax` raises errors itself; use `pcall` to catch them. Compiling can
change the tree: build a new tree for each compilation. Each occurrence of a
name needs its own node; see the [factory reference](#sec-bios-loader-constructing-and-compiling-syntax-trees).

### Names {#sec-bios-loader-name-binding-and-retained-dependencies}

A name is looked up as a local or parameter, then as a captured variable of an
enclosing function, then as an external name, and then in the environment, or as
an ordinary global if there is no environment.

| Name | Use when the code runs |
|---|---|
| Local, parameter | Its register |
| Captured variable | The variable kept by the closure |
| External name | The read or write function of its descriptor |
| Environment | `environment[name]` |
| Global | The global of that name |

Enclosing functions are those of the compiled code, not the BLua function that
calls `load`.

#### External names {#sec-bios-loader-bind-an-external-location}

An external name takes precedence over the environment; its read and write
functions are called at each access:

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
local first, second = chunk(), chunk()   -- 12, 14
```

`binding.value` becomes 14; `environment.external_value` stays 1000.

### Code storage {#sec-bios-loader-runtime-compiled-code-storage-ownership-and-lifetime}

Compiled code is stored in the BIOS code area in main RAM, one block per
compilation.

#### Lifetime {#sec-bios-loader-what-keeps-compiled-code-alive}

The block remains while any closure from that compilation exists, the closure
returned by `load` or any closure it created. When none is left, the block is
reclaimed later.

#### Example {#sec-bios-loader-retain-an-escaping-child}

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
local first = child(5)      -- 15
environment.offset = 20
local second = child(5)     -- 25
```

`child` keeps the code block, although `factory` is no longer referenced.

#### Monitor frames {#sec-bios-loader-environments-and-borrowed-bindings}

A closure keeps the environment it uses and the descriptors and functions of
its external names. When the
[monitor evaluates code in a stopped frame](bios-monitor.md#sec-memory-repair-a-word-load-and-retry),
the external names refer to that frame and remain valid only during the
evaluation; afterwards an access raises `Selected frame evaluation has ended.`
Closing a coroutine also ends them.

## Functions {#sec-bios-loader-runtime-compilation-interface}

| Function | Purpose |
|---|---|
| `load(source, chunk_name, mode, environment, external_scope)` | Compile text |
| `lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)` | Compile a syntax tree |
| `lua_compiler.syntax_factory` | Build syntax trees |

`load` is the same function as `lua_compiler.load`.

### load {#sec-bios-loader-text-loading}

```text
load(source [, chunk_name [, mode [, environment [, external_scope]]]]) -> closure | nil, error
```

| Argument | Meaning |
|---|---|
| `source` | Text to compile |
| `chunk_name` | Name for messages; nil or false gives `"=(load)"` |
| `mode` | nil, or a string containing `t` |
| `environment` | Table for names; nil uses the globals |
| `external_scope` | External names; see [below](#sec-bios-loader-environment-and-external-name-access) |

A mode without `t` (for instance `""` or `"b"`) raises
`attempt to load a text chunk (mode is '<mode>')`. Binary chunks are not
supported.

### Results {#sec-bios-loader-results-and-execution}

| Outcome | Results |
|---|---|
| Success | The closure |
| Error | nil, error value |

The error value is the value raised, which may be nil or false. Hardware
exceptions are not caught.

### Globals used {#sec-bios-loader-retained-loader-dependencies}

Without an environment, the compiled code uses the global functions that the
BIOS installed, not the current `getglobal` and `setglobal`. `load` uses its own
`pcall`; changing the globals `load`, `lua_compiler.load` or `pcall` does not
change it. It uses the current global `error` for mode errors. An environment
false is used as an environment (and fails at the first access).

### compile_syntax {#sec-bios-loader-direct-syntax-compilation}

```text
lua_compiler.compile_syntax(chunk, chunk_name [, environment [, external_scope]]) -> closure
```

Compiles a syntax tree. There is no mode, no default chunk name and no error
result: errors are raised.

### Arguments {#sec-bios-loader-written-calls-and-reached-calls}

Both functions take `external_scope` as their last argument.

### Time {#sec-bios-loader-compilation-work}

The compilation time depends on the code. The protected call in `load` takes
4 cycles.

## Language {#sec-bios-loader-runtime-loaded-source-language}

The text is a block of statements, optionally ending with `return`.

### Names, spaces and comments {#sec-bios-loader-names-spacing-and-comments}

| Element | Form |
| --- | --- |
| Name | `a`–`z`, `_` or `$`, then also digits; **no capital letters** |
| Space | Codes 32 and 9–13 |
| Comment | `--` to the end of the line |
| `;` | Optional between statements |

There are no long comments or long strings.

### Numbers {#sec-bios-loader-numeric-literals}

| Form | Examples |
| --- | --- |
| Integer | `0`, `27`, `1234` |
| Fraction | `12.5`, `.5` (a digit after the point) |
| Exponent | `1e3`, `2.5E-2` |
| Hexadecimal | `0x2a`, `0X2A` |

A sign is an operator. An integer that fits in 32 bits is an Integer, otherwise
a Float; hexadecimal gives the low 32 bits; fractions and exponents give Floats;
a literal that would be infinite is an error. See
[BLua numbers](blua-programs.md#sec-blua-programs-number-spellings).

```lua
local chunk = assert(load('return 2, 2.0, -0.0'))
local a, b, c = chunk()
-- math.type(a) is 'integer', b and c are 'float'; 1.0 / c is -math.huge
```

### Strings {#sec-bios-loader-quoted-strings}

Single or double quotes; a line end inside a string is an error.

| Escape | Meaning |
| --- | --- |
| `\'`, `\"`, `\\` | Quote, backslash |
| `\a`, `\b`, `\f` | Bell, backspace, form feed |
| `\n`, `\r`, `\t`, `\v` | Line feed, carriage return, tab, vertical tab |
| `\ddd` | Up to three decimal digits, at most 255 |
| `\xhh` | Two hexadecimal digits |
| `\z` | Skip the following spaces |

### Expressions {#sec-bios-loader-expressions-and-suffixes}

| Expression | Form |
| --- | --- |
| Name | `name` |
| Constant | Number, string, `false`, `true`, `nil` |
| Function | `function(a, b) … end` (no `...`) |
| Parentheses | `(expression)` |

Followed by any number of:

| Suffix | Form |
| --- | --- |
| Field | `.name` |
| Index | `[expression]` |
| Call | `(arguments)` |
| Method call | `:name(arguments)` |

A field or index must start at a name: `items[i].value` is allowed,
`make_items().value` is not; `make_items():method()` is allowed.

### Operators {#sec-bios-loader-operators}

| Unary | Function |
| --- | --- |
| `-x` | Negation |
| `not x` | Logical not |
| `#x` | Length |
| `&x` | String ID: x as a string, unchanged |

Binary operators, from highest to lowest precedence, all left-associative:

| Level | Operators |
| --- | --- |
| 1 | `*`, `/`, `//`, `%` |
| 2 | `+`, `-` |
| 3 | `&` |
| 4 | `==`, `~=`, `<`, `<=`, `>`, `>=` |
| 5 | `and` |
| 6 | `or` |

### Statements {#sec-bios-loader-statements}

| Statement | Form |
| --- | --- |
| Local | `local name [<const>] [= expression]` |
| Assignment | `target = expression` (one target) |
| Call | A call or method call |
| Return | `return [expression, …]` (last in its block) |
| If | `if … then … [elseif … then …] [else …] end` |
| While | `while … do … end` |
| For | `for name = start, limit [, step] do … end` (step default 1) |
| Break | `break` (inside a loop of the same function) |

### Locals and names {#sec-bios-loader-locals-closures-and-names}

`local x` sets x to nil. `local x <const> = …` needs a value and cannot be
assigned to; `const` is the only attribute. The value of a local is evaluated
before the local exists, so for a recursive function write:

```lua
local f
f = function()
  return f()
end
```

Functions capture the locals and parameters around them. Names are looked up
as local, then captured variable, then external name, then environment or
global.

### Calls and results {#sec-bios-loader-calls-and-results}

The function is evaluated before the arguments; a method call evaluates its
object once. A call returns all its results as the last argument or the last
return value, and one result elsewhere or in parentheses. `return a, f()` returns
a and all results of f; `return a, (f())` one result of f. `return` alone and the
end of a function return no results.

### Differences from BLua {#sec-bios-loader-blua-program-forms-are-not-runtime-loaded-forms}

Not available:

| BLua | Instead |
| --- | --- |
| `module<const>`, `module<entry>` | — |
| `struct`, `bss`, `data`, `rodata` | — |
| Type annotations (`:*type`) | — |
| Several names or targets | One name, one target |
| `local function f()`, `function f()` | `local f = function() … end` |
| Generic `for`, `repeat`, `do … end`, `goto` | `while`, numeric `for` |
| `halt_until_irq` | — |
| Table constructor `{…}` | Tables from the environment |
| `...` | — |

Words such as `repeat` may be used as names.

### Errors {#sec-bios-loader-source-diagnostics}

Messages have the form `[load:<chunk_name>] <message> at <line>:<column>`, for
example `upper-case identifiers are not allowed`, `unfinished string`,
`invalid numeric literal exponent`, `expected '<token>'`,
`unsupported expression` and `expected assignment or function call`. Also
errors: `return` not at the end of a block, `break` outside a loop, a const
without a value, assignment to a const, duplicate parameters, and a field path
that does not start at a name. Too large a function gives
`[load:<chunk_name>] function or expression needs too many registers`.

## Syntax trees {#sec-bios-loader-constructing-and-compiling-syntax-trees}

`lua_compiler.syntax_factory` (here `f`) builds syntax nodes; `f.syntax` (here
`s`) holds the node and operator numbers.

```lua
local f = lua_compiler.syntax_factory
local s = f.syntax
local closure = lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)
```

| Argument | Meaning |
|---|---|
| `chunk` | A chunk node |
| `chunk_name` | Name for messages (required) |
| `environment` | Optional; nil uses the globals |
| `external_scope` | Optional external names |

### Nodes {#sec-bios-loader-node-ownership-lists-and-locations}

Each function returns one node, with `kind`, `line = 1` and `column = 1` and the
fields below. The nodes hold the values passed to them. A node is one
occurrence: build a new node for every use, also of the same name. Lists are
ordinary tables 1…n; pass `{}` for an empty list.

### Chunk, block, names and constants {#sec-bios-loader-chunk-blocks-names-and-literals}

| Function | Fields |
|---|---|
| `chunk(body)` | `kind = s.chunk`, `body` (a block) |
| `block(statements)` | `kind = s.block`, `statements` |
| `identifier(name)` | `kind = s.identifier_expression`, `name` (a string) |
| `generated_symbol(name)` | `{ name = name }`, a unique name key |
| `reference(symbol)` | `kind = s.identifier_expression`, `name = symbol` |
| `number_literal(value)` | `kind = s.number_literal_expression`, `value` |
| `string_literal(value)` | `kind = s.string_literal_expression`, `value` |
| `boolean_literal(value)` | `kind = s.boolean_literal_expression`, `value` |
| `nil_literal()` | `kind = s.nil_literal_expression` |
| `literal(value)` | Number, string or boolean node, by type of value |

A generated symbol is a name of its own, also if another has the same text;
use `reference(symbol)` for each occurrence. `literal(nil)` raises an error;
use `nil_literal()`.

### Expressions {#sec-bios-loader-paths-calls-operators-and-functions}

| Function | Fields |
|---|---|
| `member_expression(base, name)` | `kind = s.member_expression`, `base`, `identifier` (the field name as a string) |
| `index_expression(base, index)` | `kind = s.index_expression`, `base`, `index` (an expression) |
| `index_path(base, path)` | Nested index nodes for the constants in `path` |
| `call_expression(callee, arguments, method_name)` | `kind = s.call_expression`, `expands_results = true`, `callee`, `arguments`, `method_name` |
| `binary_expression(op, left, right)` | `kind = s.binary_expression`, `operator`, `left`, `right` |
| `unary_expression(op, operand)` | `kind = s.unary_expression`, `operator`, `operand` |
| `function_expression(parameters, body)` | `kind = s.function_expression`, `parameters`, `body` |

Field and index paths must start at a name. For a method call, `callee` is the
object and `method_name` the method name; the object is not repeated in
`arguments`. Operators are the numbers in `s`. Parameters are identifier nodes.

### Statements {#sec-bios-loader-assignments-declarations-calls-and-conditionals}

| Function | Fields |
|---|---|
| `assignment_statement(target, value)` | `kind = s.assignment_statement`, `target`, `value` |
| `local_statement(name, initializer, is_const)` | `kind = s.local_statement`, `name` (an identifier node), `initializer`, `is_const` |
| `call_statement(expression)` | `kind = s.call_statement`, `expression` (a call node) |
| `if_clause(condition, block)` | `{ condition, block }` |
| `else_clause(block)` | `{ block }` |
| `if_statement(clauses)` | `kind = s.if_statement`, `clauses` |

The initializer of a local is evaluated before the local exists. Put the else
clause last.

### Loops and return {#sec-bios-loader-loops-and-returns}

```lua
numeric_for_statement(variable, start_expression, limit_expression, step_expression, block)
```

`variable` is an identifier node; a nil step means 1.

| Function | Fields |
|---|---|
| `while_statement(condition, block)` | `kind = s.while_statement`, `condition`, `block` |
| `return_statement(expressions)` | `kind = s.return_statement`, `expressions` |
| `break_statement()` | `kind = s.break_statement` |

### Results {#sec-bios-loader-result-counts}

| Use of a call | Results |
|---|---|
| In an expression | One |
| As a statement | None |
| Last argument or last return value | All, if `expands_results` is true |
| `return` alone, end of function | None |

To use one result of a last call, set its `expands_results` to false.

### Names {#sec-bios-loader-lexical-names-and-captured-bindings}

A name string is looked up as in text; a generated symbol must be a local or
captured variable, otherwise compilation raises an error. Nested functions use
the same environment and external names.

### Environment and external names {#sec-bios-loader-environment-and-external-name-access}

An environment other than nil is indexed at each access. External names are
given as:

```lua
external_scope = {
    names = name_keyed_descriptors,
    read = read_binding,
    write = write_binding,
}
```

| Field | Meaning |
|---|---|
| `names` | Table from name to descriptor |
| `descriptor.is_type` | A type, not usable as a value |
| `descriptor.available` | false: the name has no value at present |
| `descriptor.is_const` | true: the name cannot be assigned to |
| `read` | Called as `read_binding(descriptor)` at a read |
| `write` | Called as `write_binding(descriptor, value)` at an assignment |

A descriptor may hold further fields for its read and write functions.

### Node numbers {#sec-bios-loader-exported-node-constants}

| Constant | Value | Constant | Value | Constant | Value |
|---|---:|---|---:|---|---:|
| `chunk` | 1 | `index_expression` | 8 | `call_expression` | 15 |
| `block` | 2 | `number_literal_expression` | 9 | `local_statement` | 16 |
| `assignment_statement` | 3 | `string_literal_expression` | 10 | `if_statement` | 17 |
| `return_statement` | 4 | `boolean_literal_expression` | 11 | `while_statement` | 18 |
| `function_expression` | 5 | `nil_literal_expression` | 12 | `break_statement` | 19 |
| `identifier_expression` | 6 | `unary_expression` | 13 | `call_statement` | 20 |
| `member_expression` | 7 | `binary_expression` | 14 | `numeric_for_statement` | 21 |

### Unary operators {#sec-bios-loader-exported-unary-operators}

| Constant | Value | Operator |
|---|---:|---|
| `unary_negate` | 1 | `-` |
| `unary_string_id` | 2 | `&` |
| `unary_not` | 3 | `not` |
| `unary_length` | 4 | `#` |

### Binary operators {#sec-bios-loader-exported-binary-operators}

| Constant | Value | Constant | Value |
|---|---:|---|---:|
| `binary_add` | 1 | `binary_less` | 9 |
| `binary_subtract` | 2 | `binary_less_equal` | 10 |
| `binary_multiply` | 3 | `binary_greater` | 11 |
| `binary_divide` | 4 | `binary_greater_equal` | 12 |
| `binary_floor_divide` | 5 | `binary_and` | 13 |
| `binary_modulus` | 6 | `binary_or` | 14 |
| `binary_equal` | 7 | `binary_bitwise_and` | 15 |
| `binary_not_equal` | 8 | | |

### Errors {#sec-bios-loader-errors-and-compiler-owned-fields}

Messages have the form `[load:<chunk_name>] <message> at <line>:<column>`
(always `1:1` for factory nodes). Compilation raises an error for: duplicate
parameters, a generated symbol that is not found, a field path that does not
start at a name, assignment to a const, a const without a value, `break` outside
a loop, `return` not at the end of a block, an unknown node, and an external
name that is a type or not available. Too large a function gives
`[load:<chunk_name>] function or expression needs too many registers`.

Fields other than those listed are used by the compiler; do not set them.

## Code area {#sec-bios-loader-code-arena-capacity-and-allocation}

Compiled code is stored in a separate code area; tables and closures are in
BLua storage.

### Size {#sec-bios-loader-storage-limits}

| Item | Value |
| --- | --- |
| Code area | 256 KiB (`00040000H`), in the [BIOS RAM area](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram) |
| Block alignment | 16 bytes |
| Block header | 16 bytes |
| Smallest remainder kept free | 32 bytes |
| Message when full | `runtime compiler memory exhausted` |

### Block size {#sec-bios-loader-resource-accounting}

| Item | Bytes |
| --- | --- |
| Function record | 32 per function (F) |
| Capture descriptor | 4 per descriptor (D) |
| Instruction | 4 per word (W) |

```text
block size = 16 × ceiling((16 + 32F + 4D + 4W) / 16)
```

A function can have at most 16,384 registers, constants and temporaries
included.

### Allocation {#sec-bios-loader-allocation-collection-and-failure}

Each compilation needs one contiguous block. When there is no room, unused
blocks are reclaimed first; if there is still no room, compilation raises
`runtime compiler memory exhausted`. Compile at a moment when the time can be
spared. BLua storage can run out separately.

### Startup {#sec-bios-loader-system-startup-and-compiled-code-storage}

The BIOS sets up the code area at startup. It remains when a program starts;
a reset clears it. See [EXEC](cpu.md#sec-cpu-exec).
