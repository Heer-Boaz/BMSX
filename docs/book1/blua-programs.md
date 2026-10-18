# BLua source programs

This chapter describes source programs built into a cartridge: spelling and
statements, file-to-module names, literal imports, startup exports and the
installed BIOS environment. It is not the contract of the separate BIOS
runtime source compiler or firmware shell.

The [CPU reference](cpu.md#calls-closures-globals-and-tables) defines values,
ordinary calls, results, captures and global operations; its
[operator reference](cpu.md#blua-operators-and-instruction-costs) defines their
execution. [Memory](memory.md#typed-byte-storage-and-address-views) defines
static storage, typed declarations, address views and initialization. These
remain the companion definitions for the source forms below.

Each of the three complete programs supplies every source file. Follow its
separate development-companion route for the project tree, manifest, build
commands and output observation:
[modules and globals](../programming/getting-started.md#build-and-inspect-modules-and-globals),
[numeric loops](../programming/getting-started.md#build-and-inspect-numeric-loops), or
[generic iteration](../programming/getting-started.md#build-and-inspect-generic-iteration).

## Source text and names

This section describes the source forms accepted by the cartridge compiler. The module sections explain how source files participate in a linked cartridge. Source grammar and SDK build-quality policy are separate: a form accepted by the parser can still be subject to additional build rules.

For runtime values, arithmetic, condition evaluation and call results, use the [CPU reference](cpu.md). For typed byte storage, pointers and mapped accesses, use the [Memory reference](memory.md).

### Identifiers and keywords

An identifier begins with a lowercase ASCII letter, `_` or `$`. Following characters may also be decimal digits. Uppercase ASCII letters are rejected anywhere in an identifier; non-ASCII letters are not identifier characters.

| Accepted identifiers | Not identifier spellings |
| --- | --- |
| `position`, `frame2`, `_scratch`, `$state` | Names beginning with a digit, containing an uppercase letter, or using non-ASCII letters |

The reserved keywords are:

```text
and break do else elseif end false for function goto halt_until_irq
if in local nil not or repeat return then true until while
```

Other source features have context-sensitive spellings. For example, `const`, `entry`, `init`, `struct`, `bss`, `data`, `rodata`, `sizeof` and `offsetof` are not members of this lexical keyword list. Their use is defined by the relevant declaration, module or memory form.

The compiler also reserves these names against declaration as locals or parameters:

```text
mem mem8 mem16le mem32le memf32le memf64le blua32 cop0
```

They name compiler-owned mapped-access or intrinsic forms, not ordinary replaceable local variables. Their detailed forms are covered by the [Memory reference](memory.md) and [CPU reference](cpu.md). This is not a complete catalogue of BIOS names or SDK naming policies.

### Comments, whitespace and statement boundaries

Spaces, horizontal tabs, carriage returns, vertical tabs and line feeds separate tokens. Comments are also skipped between significant tokens.

```lua
-- a comment through the end of this line

--[[
a long comment
]]

--[=[
a long comment that can contain ]]
]=]
```

Long comments use matching bracket delimiters with the same number of `=` characters. They do not nest: the first matching closing delimiter ends the comment. An unterminated long comment is an error.

Statements generally do not need semicolons. A semicolon on its own in a block is ignored.

```lua
local position = 0
position += 2;
;
position += 3
```

Do not treat every newline as interchangeable with a space. A `*` that begins a new line is not consumed as a binary continuation of the preceding expression; this allows a dereference statement to start on that line. Keep a multiplication continuation's `*` on the preceding expression line. Surrounding the expression with parentheses does not remove this newline rule. This is a specific rule for `*`, not a general rule for every operator.

`return` has its own boundary rules, described under [Return statements](#return-statements).

## Literal expressions

The literal expression forms are `nil`, `true`, `false`, Number literals and String literals. Their runtime representations and operations are specified in the [CPU reference](cpu.md), with storage details in the [Memory reference](memory.md).

### Number spellings

Decimal literals begin with a digit, or with `.` followed by a digit. A fractional dot after integer digits is part of the number only when another digit follows it. An exponent uses `e` or `E`, an optional sign, and one or more decimal digits.

| Form | Examples |
| --- | --- |
| Decimal integer | `0`, `12`, `480` |
| Decimal fraction | `12.5`, `.5` |
| Decimal exponent | `1e3`, `1E-3`, `1.5e+2` |
| Hexadecimal integer | `0xff`, `0XFF` |
| Hexadecimal fraction | `0x1.8`, `0x.8` |
| Hexadecimal binary exponent | `0x1.8p+2`, `0x.8p-1` |

Hexadecimal literals begin with `0x` or `0X`. Their digits may use either case, independently of the lowercase-only identifier rule. They require at least one hexadecimal digit across the integer and fractional parts. A `p` or `P` exponent has decimal digits and scales the hexadecimal value by a power of two.

A literal whose parsed numeric value is non-finite is rejected. Unary `-` is a separate operator, so `-12` is an expression rather than one signed numeric token. Use `1.0` rather than `1.` for a decimal fraction. Digit separators, binary or octal prefixes, and numeric suffixes are not supplied by these literal forms.

Hexadecimal spelling does not create a distinct address or register-word literal type. It is another spelling of a Number literal; address and typed-storage use belongs to the [Memory reference](memory.md).

### Short Strings

A short String uses matching single or double quotes. The other quote can appear without escaping.

```lua
local prompt = "pilot's name"
local message = 'press "start"'
local lines = "ready\nlaunch"
```

A literal line feed before the closing quote is rejected, as is an unterminated short String. The supported escapes are:

| Escape | Decoded character or action |
| --- | --- |
| `\a` | Alert |
| `\b` | Backspace |
| `\f` | Form feed |
| `\n` | Line feed |
| `\r` | Carriage return |
| `\t` | Horizontal tab |
| `\v` | Vertical tab |
| `\\` | Backslash |
| `\"` | Double quote |
| `\'` | Single quote |
| `\xHH` | Character selected by exactly two hexadecimal digits |
| `\ddd` | Character selected by one to three decimal digits, with a value no greater than 255 |
| `\z` | No character; discard the following contiguous whitespace |

Here `HH` and `ddd` are notation for digits, not literal suffixes. `\z` consumes spaces, horizontal tabs, carriage returns, line feeds, vertical tabs and form feeds until the next non-whitespace character.

```lua
local message = "prepare\z
    for launch"
```

Unsupported escapes are rejected. There is no `\u{...}` escape or backslash-newline continuation. `\0` is the decimal escape for zero, not a separate escape family. Escape decoding does not by itself specify the resulting String's byte encoding; use the [CPU reference](cpu.md) and [Memory reference](memory.md) for that contract.

### Long Strings

Long Strings use matching bracket delimiters, with an optional matching run of `=` characters:

```lua
local briefing = [[
reach the beacon
then return to the dock
]]

local marker = [=[a literal ]] inside the text]=]
```

One initial carriage return, carriage-return/line-feed pair or line feed immediately after the opening delimiter is skipped. After that, content is copied literally until the matching close delimiter. Short-String escapes are not translated. The delimiters do not nest, and an unterminated long String is rejected.

## Declarations and assignment

### Local bindings

An ordinary local declaration names one or more bindings, optionally followed by an expression list:

```lua
local position
local left, right
local x, y = 12, 24
```

An uninitialized ordinary local is initialized to `nil`. Expression-list adjustment is part of the [CPU call-and-result contract](cpu.md), not a separate rule introduced by declaration syntax.

Each name may carry `<const>` immediately after it:

```lua
local stride<const> = 4
local width<const>, height<const> = 32, 24
```

A const binding requires an initializer position under the compiler's expression-list rules. Later rebinding is rejected, including rebinding through a captured const name. This is constness of the binding, not recursive immutability of the value it names: assignment to a member or index is a different target category. The `<close>` attribute is unsupported, and other local attribute names are rejected.

A typed-pointer annotation, when used, follows the attribute: `local cursor<const>:*type = expression`. Typed declarations and their storage contract are defined in the [Memory reference](memory.md).

Ordinary initializer expressions are resolved before the new local names become visible. In the following fragment, the inner initializer reads the preceding visible `position`, not an uninitialized version of the new binding:

```lua
local position = 8
do
    local position = position + 4
    position += 2
end
```

<div class="keep-together">

Two function forms make their local binding available to their own function body for recursion:

- `local function name(parameters) ... end`;
- a single-name, single-value declaration of the form `local name<const> = function(parameters) ... end`.

Do not generalize this exception to other initializers or to multi-name declarations.

</div>

### Assignment targets

Assignment without `local` writes to its targets:

```lua
position = next_position
left, right = right, left
settings.speed = 3
samples[index] = value
```

For a bare name, assignment updates its resolved visible binding. A write with no lexical binding declares a global through the compiler's binding rules; there is no separate `global` declaration keyword. This does not mean that every unresolved read or misspelled name is accepted. Global namespace, storage and lifetime rules belong to the module material and [CPU reference](cpu.md).

The assignable source forms are a bare identifier, a named member, an indexed expression and a unary dereference. A call or a numeric expression is not an assignment target. Dereference assignment additionally requires the typed-storage form accepted by the compiler; an untyped dereference assignment is rejected. See the [Memory reference](memory.md).

The augmented forms are exactly:

| Source form | Required shape |
| --- | --- |
| `target += expression` | One target and one expression |
| `target -= expression` | One target and one expression |
| `target *= expression` | One target and one expression |
| `target /= expression` | One target and one expression |
| `target %= expression` | One target and one expression |
| `target ^= expression` | One target and one expression |

There are no `//=`, `&=`, `|=`, shift-assignment or `..=` forms, and no increment/decrement statement forms. In particular, `--` begins a comment.

An arbitrary expression is not a standalone statement. Apart from dedicated statement forms, a non-assignment expression statement must be a call.

## Functions and calls

<div class="keep-together">

### Function declarations and expressions

A local function declaration uses one bare name:

```lua
local function advance(position, velocity)
    return position + velocity
end
```

</div>

A named function declaration can also use `function name(...) ... end` or a dotted target:

```lua
local motion = {}

function motion.advance(position, velocity)
    return position + velocity
end
```

Further dotted path components are permitted. The declaration stores the function in that target; it does not create missing namespace tables. The local-function form does not accept a dotted or colon target.

A colon declaration adds an implicit first parameter named `self`:

```lua
local counter = { value = 0 }

function counter:add(amount)
    self.value += amount
end

counter:add(3)
```

An anonymous function is an expression:

```lua
local advance<const> = function(position, velocity)
    return position + velocity
end
```

Written parameters are comma-separated identifiers. A final `...` is permitted, including as the entire parameter list; no parameter may follow it. Captures, frames, argument adjustment, vararg values and call results are specified by the [CPU reference](cpu.md).

### `<init>` and normal startup

The `<init>` attribute is permitted only on a local function declared directly at chunk or runtime-module top level, with the attribute between its name and parameter list: `local function name <init>()`. The function must have no parameters or varargs. It cannot be declared in a compile-time module, inside another function or a block (including `if`, loop, and `do` bodies), or as an ordinary global or method declaration. A non-entry module containing such a function must be in the [scheduled module set](#initialization-happens-before-entry); an otherwise unscheduled source file is rejected. The declaration creates an ordinary lexical closure; it does not execute the function body. **`<init>` does not call the function automatically during normal cartridge startup.** Normal startup initializes the data and zero-initialized sections, performs ordinary module top-level work, and then calls the entry function. Put ordinary boot initialization in module top-level code or the entry function; explicitly call a function there if its body must run at boot.

<div class="keep-together">

### Call spelling

The following table shows call forms. `callee`, `receiver` and the argument names stand for values supplied by the program.

| Form | Source spelling |
| --- | --- |
| No written arguments | `callee()` |
| Expression list | `callee(first, second)` |
| One literal Table argument | `callee { speed = 2 }` |
| One literal String argument | `callee "ready"`, `callee 'ready'`, `callee [[ready]]` |
| Method call | `receiver:advance(amount)` |
| Method with literal Table argument | `receiver:configure { speed = 2 }` |
| Method with literal String argument | `receiver:announce "ready"` |

</div>

Call, index and member suffixes may be chained. A colon member must be followed by call arguments; `receiver:advance` on its own is not a colon-property expression. Receiver handling and argument/result behavior are defined by the [CPU reference](cpu.md).

### Variable arguments and result positions

`...` reads the variable arguments available to the **current call**. A nested function does not inherit an enclosing call’s variable arguments.

The current software accepts `...` as an expression even when the function’s written parameter list contains no `...`, and in the entry chunk. This does not make a bare `...` a statement. A function without `...` in its parameter list has **zero available variable arguments**, even if its caller supplies extra arguments; the entry chunk likewise has zero available variable arguments.

Zero available arguments are not the same as one `nil` result. With zero available variable arguments, an open-result use of `...` supplies zero values. When a context requests a fixed number of result positions, unavailable positions are filled with `nil`; selecting one result therefore gives `nil` in this case. For argument and result transfer at the machine-call boundary, see [CPU calls](cpu.md#calls-closures-globals-and-tables).

### Return statements

A return expression list is written as:

```lua
return position, velocity
```

A semicolon may follow that list:

```lua
return position, velocity;
```

<div class="keep-together">

An expressionless `return` is recognized only when its next significant token is `end`, `else`, `elseif`, `until` or the end of the source. A newline alone does not terminate it. For example, this still supplies the expression `position`:

```lua
return
    position
```

</div>

`return;` is not an accepted spelling of an expressionless return. To return without a written expression, place `return` before one of the terminators listed above, as in:

```lua
local function stop()
    return
end
```

The absence of a written expression is not a specification of a zero-result call. Return values and result adjustment are defined in the [CPU reference](cpu.md).

## Expressions

### Parentheses, access and constructors

Parentheses group an expression and preserve the enclosed expression. They are not a separate result-count operator; do not infer different call-result adjustment merely from writing `(callee())`. Use the [CPU reference](cpu.md) for result behavior.

The member and index source forms are:

| Form | Spelling |
| --- | --- |
| Indexed access | `base[index]` |
| Named member | `base.name` |
| Typed member form | `base->name` |

Typed interpretations, direct memory forms and address views are defined by the [Memory reference](memory.md).

<div class="keep-together">

A Table constructor can contain list-value fields, named fields and expression-keyed fields in the same constructor:

```lua
local route = {
    "dock",
    "ridge";
    active = true,
    [4] = "gate",
}
```

`{}` is the empty constructor. Commas and semicolons separate fields; one trailing separator is permitted. These forms describe constructor syntax, not a Table-length or inherited-read rule.

</div>

<div class="keep-together">

### Operator precedence

The table runs from lowest precedence to highest. Binary groups associate to the left unless marked otherwise.

| Precedence | Operators | Association |
| --- | --- | --- |
| Lowest | `or` | Left |
| | `and` | Left |
| | `==` `~=` `<` `<=` `>` `>=` | Left |
| | `\|` | Left |
| | Binary `~` | Left |
| | `&` | Left |
| | `<<` `>>` | Left |
| | `..` | Right |
| | `+` `-` | Left |
| | `*` `/` `//` `%` | Left |
| | Unary forms | Prefix |
| Highest | `^` | Right |

</div>

The unary spellings are `not`, `-`, `#`, `~`, `&` and `*`. The unary `&` and `*` forms have BMSX-specific String-id/address-view meanings; their typed uses are specified in the [Memory reference](memory.md). The presence of `#` in the grammar does not itself define a Table-length contract.

Exponentiation binds more tightly than a leading unary minus. Thus `-2 ^ 2` groups as `-(2 ^ 2)`. A unary expression is accepted on the right of a power, so `2 ^ -2` is also valid source. These statements describe expression grouping, not arithmetic precision, rounding or range.

For operation meanings, arithmetic and bitwise behavior, comparison, truth and [logical evaluation](cpu.md#logical-expressions), use the [CPU reference](cpu.md).

## Control flow

### Conditional branches

```lua
if position < limit then
    position += stride
elseif position > limit then
    position -= stride
else
    position = origin
end
```

There may be zero or more `elseif` branches and at most one `else` branch. Each branch has its own compiled lexical scope. Condition evaluation follows the [CPU reference](cpu.md).

<div class="keep-together">

### While and repeat loops

A `while` loop writes its condition before the body:

```lua
local remaining = 3
while remaining > 0 do
    remaining -= 1
end
```

</div>

A `repeat` loop writes the terminating condition after the body:

```lua
local attempts = 0
repeat
    attempts += 1
until attempts >= 3
```

These are the source forms `while expression do block end` and `repeat block until expression`. Runtime condition behavior is defined in the [CPU reference](cpu.md).

### Numeric `for`

```text
for name = start, limit [, step] do
    block
end
```

Square brackets mark the optional step; they are not written in the source.

The header evaluates `start`, then `limit`, then the explicit `step`, once
before the first test on each ordinary entry into the statement. Each
expression supplies one result, including a call expression. Omitting `step`
supplies Number `1`; supplying `0` does not omit it. The start result initializes the loop variable. The limit
and step results are retained for subsequent tests and updates: assigning to
an outer variable used by a header expression does not reevaluate that
expression or replace its retained result.

The header expressions use the enclosing scope. Only the body has the new
local binding named by `name`, so a same-named reference in the header still
refers to its enclosing binding. The loop binding is not visible after the
loop. A distinct local declared inside the body can shadow it in the usual
lexical way.

Before each body entry, let `i` denote the current loop variable, `limit` the
retained limit, and `step` the retained step. The selector and exit tests are:

| Selector | Exit before the body when | Finite-Number reading |
| --- | --- | --- |
| `0 < step` is true | `limit < i` | The body is allowed while `i <= limit`. |
| `0 < step` is false | `i < limit` | The body is allowed while `i >= limit`. |

The exit predicates are the strict comparisons shown, not universal
`<=`/`>=` tests. The inclusive paraphrases apply to finite Numbers; they do not
establish termination for every Number value. For Number operands, the loop
uses ordinary Number arithmetic rather than an integer-only counter.

Ordinary fallthrough from the body adds the retained step to the loop
variable's **current** value, then repeats the selector and test. Assignment to
the unshadowed loop variable is permitted and changes that same control
variable, not a hidden copy. It affects the tail addition and next test; it
does not trigger a new range check halfway through the body. A `break` leaves
the loop without performing the tail addition.

An explicit zero step is accepted, not replaced by one or rejected as a
zero-step error. It takes the second test above. With finite Numbers, a start
below the limit skips the body, while a start equal to or above the limit
allows initial entry. If the body leaves the variable unchanged, adding zero
makes no counter progress. This does not make every zero-step loop empty or
promise that every entered one runs forever: changing the loop variable can
make the next test exit, and `break` can leave immediately.

See the [complete numeric-loop control program](#complete-program-numeric-loop-control)
for evaluated headers, retained limits and steps, forward and reverse body
mutation, and finite zero-step examples. Its entered zero-step loops use
explicit `break` statements.

The control path uses ordinary [Number addition and comparison](cpu.md#values-and-numeric-instructions);
header and body calls have the usual [call and result-adjustment costs](cpu.md#calls-closures-globals-and-tables).
Use the [instruction-cost guide](cpu.md#blua-operators-and-instruction-costs) and
[cycle-accounting boundaries](cpu.md#cycle-accounting-and-execution-boundaries)
for the selected instructions and executed path, rather than assigning the
source loop a fixed per-iteration cycle charge.

### Generic `for`

A generic `for` obtains each set of loop-variable values by calling an iterator:

```text
for name [, name ...] in expression [, expression ...] do
    block
end
```

There must be at least one loop name and one expression after `in`.

Before the first iteration, the expression list is evaluated once, in source order, and adjusted to three values: **iterator, state, control**. Each expression before the last supplies one value. Only the final expression can supply multiple results: a final call or `...` can fill the remaining entries. Missing entries become `nil`; surplus values are discarded. With three or more expressions, each supplies one value and only the first three values are retained. **Every expression is still evaluated**, including expressions whose results are discarded. Their effects and errors occur before the first iterator call.

Grouping parentheses do not force a call to supply only one result in BLua. In particular, a final `(factory())` can still supply multiple values to this list.

The three retained values are cached, not recomputed on subsequent iterations. Rebinding a source variable does not replace its cached value. Caching a mutable value does not copy its contents: changes to shared contents remain visible.

Each attempted iteration calls exactly:

```text
iterator(state, control)
```

The call requests as many results as there are loop names. Extra results are discarded and missing results become `nil`.

- If the first adjusted result is `nil`, the loop ends without assigning that call's results to the loop variables or executing the body.
- Otherwise, all adjusted results are assigned to the visible loop variables. The first result also becomes the hidden control value **before** the body starts. After the body, the next iterator call uses that control.

Only `nil` stops iteration: a first result of `false` continues and becomes the next control value. A later result of `nil` does not stop the loop. See [values](cpu.md#values-and-numeric-instructions).

The visible loop variables are writable locals. Reassigning them in the body does not change the already saved hidden control; the next successful iteration replaces their values with new results. Their lexical scope is the loop body. The new locals are not in scope in the `in` expressions or after `end`; a loop name in its own initializer does not refer to the new local.

A reached `break` exits the nearest enclosing loop, skipping the remaining body and subsequent iterator calls.

Iteration uses [ordinary calls](cpu.md#calls-closures-globals-and-tables), passing state and control unchanged. A non-callable iterator causes an error at the attempted call, not an empty loop. Other errors occur at the expression, call or body operation reached. The ordinary [execution costs and boundaries](cpu.md#cycle-accounting-and-execution-boundaries) apply to the loop operations, iterator calls and body.

See [iteration routines](bios-base.md#traversal-argument-selection-globals-and-output) and the [complete generic-iteration program](#complete-program-generic-iteration).

<div class="keep-together">

### Blocks and break

`do ... end` creates a nested lexical scope:

```lua
local position = 0
do
    local stride = 4
    position += stride
end
```

</div>

`break` takes no argument and exits the innermost current loop. It is rejected outside a loop. A following semicolon is optional.

```lua
local total = 0
for index = 1, 8 do
    total += index
    if total >= 10 then
        break
    end
end
```

There is no `continue` statement keyword.

<div class="keep-together">

### Labels and goto

A label is written `::name::`; a branch to it is written `goto name`.

```lua
local attempts = 0
::retry::
attempts += 1
if attempts < 3 then
    goto retry
end
```

</div>

Label names have **function-wide scope**, not block scope. A `goto` can name a label written before or after it, including a label in another lexical block of the same function. A nested function has its own label names: a label in another function cannot satisfy the jump. Each chunk also has its own label scope.

A second label with the same name in one function is rejected as `Duplicate label 'name'.`, even if the labels occupy different blocks. A target name not defined in that function is reported as `Missing label(s): ...`. A same-spelling label in a separate function is independent.

The current software does not reject a jump merely because it crosses a local declaration or enters or leaves a lexical block. The jump must still have a defined target and an encodable displacement. These are not checks on local scope or initialization.

Acceptance does **not** insert skipped initialization, local cleanup, or capture-close operations. A forward jump can skip initializers; a backward jump resumes at its earlier target. Neither crossing establishes a blanket value for a skipped local: in particular, it does not guarantee a fresh `nil` value or recreate locals on a backward jump. Keep required initialization on the executed path; a jump is not a block-entry initialization operation.

### Waiting for an interrupt

```lua
halt_until_irq
```

`halt_until_irq` is a reserved statement with no parentheses or arguments. A following semicolon is optional. It lowers directly to the processor's halt instruction; it is not a BIOS function call. Interrupt enable, mask, pending and wakeup behavior belongs to the [CPU reference](cpu.md) and [interrupt reference](irq.md).

## Source files and module names

A BLua cartridge program consists of source modules. Each module has a path, may depend on other modules, and may publish one exported value. One module is the program entry.

<div class="keep-together">

A module attribute, when present, belongs at the beginning of the file, before its statements. The available headers are:

| Header | Meaning |
| --- | --- |
| No header | An ordinary source module. |
| `module<entry>` | The cartridge's entry module. |
| `module<const>` | A compile-time export namespace or a root static function. |

</div>

A semicolon may follow the header. The header does not give the module its name, and these are alternative attributes, not a combined declaration. A cartridge must contain **exactly one** `module<entry>` among its supplied program modules. A missing entry or two entry modules is a build error.

For example, an entry file begins with:

```lua
module<entry>
```

The module name comes from the source path. It is not the name of a local variable that imports the module, and it is not a numeric asset identifier. For cartridge sources beneath `carts/<cartridge>/`, that leading directory is removed; the final `.lua` extension is removed as well. A leading `res/` is also removed when it is the applicable source prefix. Backslashes become forward slashes.

| Source path | Module path |
| --- | --- |
| `carts/example/lib/runtime_settings.lua` | `lib/runtime_settings` |
| `carts/example/lib/runtime_settings.LUA` | `lib/runtime_settings` |
| `cartlib/gx/display.lua` | `cartlib/gx/display` |
| `res/lib/runtime_settings.lua` | `lib/runtime_settings` |

The remaining path text keeps its case. Dots within a name are not converted to slashes. Use the supplied module's literal path; do not infer a dotted-name search convention or relative-file search from the spelling of an import. Two source files cannot provide the same module path. There is no duplicate-path winner or namespace merge.

## Imports and executable inclusion

The built-in `require` names a module at compile time. Its argument must be exactly one string literal:

```lua
local settings = require('lib/runtime_settings')
```

The string-argument form is equivalent:

```lua
local settings = require 'lib/runtime_settings'
```

A computed path, a second argument, or a method-style call is not a built-in module import. The built-in is recognized when `require` is an unshadowed identifier. A local binding with that name is an ordinary binding, not another way to access the built-in. Keep the name unshadowed when using it for imports; do not alias it to construct an alternative import interface. Dependency discovery scans literal import forms syntactically; do not use shadowing as a way to remove a module dependency.

The named module must be supplied to the program or be an installed named import. An unavailable module is a compilation error, not a missing-file exception raised while the cartridge runs. `require` does not open arbitrary source files during execution.

Executable inclusion begins with the entry, any additional supplied module roots, and generated roots. It follows their literal import dependencies transitively. Supplying source text alone does not mean every otherwise-unreachable module becomes executable code. Library inclusion follows the same literal-dependency closure over the available library modules.

An import written inside a function still contributes a dependency. Moving an import into a function is therefore not a way to defer inclusion or ordinary dependency initialization until that function is called.

## Initialization happens before entry

Ordinary source modules perform their top-level work during program startup. Dependencies are initialized before the modules that depend on them, and the scheduled ordinary module initializers run before the cartridge entry begins. Section initialization precedes those module initializers.

This is an eager dependency-initialization contract, not a loader that waits for the first evaluated `require` call. For example, in the following fragment, the ordinary dependency has already performed its top-level initialization before entry execution reaches the written import:

```lua
module<entry>

local settings = require('lib/runtime_settings')
```

The same applies when that import is written in a function body rather than directly in the entry's top-level statements. A `require` expression obtains the module's retained export; it does not execute the initializer anew at that line. A stand-alone import can be used when only the module's initialization is wanted:

```lua
require('lib/setup')
```

An ordinary dependency cycle is a compilation error. Do not arrange mutually dependent ordinary modules in the expectation that an incomplete export table will be supplied to break the cycle. Likewise, do not rely on filenames, asset identifiers, or a directory scan to order unrelated initializers. Express an initialization dependency with an import.

Completion and the exported value are separate state. A successful initializer records completion even if it publishes `nil` or `false`; a later import does not repeat the initializer merely because its export is false-valued. This guarantee concerns the initialized program state. It does not define what survives a reset or replacement of that state.

Recognized `module<const>` exports and installed static function imports have no ordinary source-module initializer to run at their import sites.

<div class="keep-together">

## Publishing an ordinary module value

An ordinary module declares its export with a **final top-level `return` containing exactly one expression**:

```lua
return settings
```

</div>

That expression supplies one module value. It may be a table, a function, a scalar, `false`, or `nil`.

| End of the module | Import result |
| --- | --- |
| `return settings` | The value of `settings`. |
| `return false` | `false`. |
| `return nil` | `nil`. |
| `return make_module()` | The first result of `make_module()`. |
| No final single-expression export | `true`. |

A factory call does not create several exports. With `return make_module()`, only the call's first result becomes the module value. Additional values returned by the factory are not available as extra results from `require`.

Only the final top-level statement establishes this export contract. A return inside a function or another nested construct does not establish it. Neither a bare final `return` nor a final `return a, b` establishes it. An ordinary module without the contract still has its scheduled initializer, but an import expression supplies `true`. Additional result positions requested from an import receive `nil`, whether the module has a declared export or supplies the default `true`.

For a module with a declared export, arrange its top-level flow to reach that final export. Do not use an earlier return as an alternative way to publish a different module value.

### Exported objects remain ordinary objects

An ordinary module's exported table is a runtime table, not an immutable namespace. Repeated imports obtain the same published root object. A field update through one reference is visible through another reference to that object.

For example, these are two imports of the same ordinary module, not requests for two new instances:

```lua
local first = require('lib/actions')
local second = require('lib/actions')

first.perform = replacement
second.perform()
```

The final expression looks up the table's current `perform` field and calls that value. It is not permanently bound to the function that occupied the field when the module was first compiled. Keeping a function in a separate local is a different operation from performing a later field lookup.

Use an ordinary module when the API is an ordinary exported object or function, including an object whose fields will change during execution. A `module<const>` namespace has a different contract.

## Compile-time modules

`module<const>` publishes a compile-time namespace of named exports, or a root static function. It does not publish an ordinary allocated module table.

<div class="keep-together">

A small named namespace can be written as:

```lua
module<const>

return {
    limit = 12,
    offset = {
        x = -2,
        y = 3,
    },
}
```

</div>

Import such a namespace through a const local and select its named exports:

```lua
local settings<const> = require('lib/settings')

local limit = settings.limit
local offset_x = settings['offset'].x
```

Named fields and literal-string indexed fields select export paths. Namespace declarations use named table fields or literal string keys. Positional array entries and computed keys are not the named-export mechanism.

Recognized constant leaves include `nil`, booleans, numbers, strings, and static-storage addresses. Numeric constant expressions and unary minus can be folded in these exports. Static functions may also occupy named export paths. A named leaf must be a supported compile-time constant or static function; an arbitrary runtime expression is not a constant export merely because it appears in a `module<const>` file. A scalar-only return is not a substitute for a named namespace or a root static function.

### A const local is not a const module

These two declarations apply to different parts of a program:

| Declaration | What it describes |
| --- | --- |
| `module<const>` | The exporting file and its compile-time export contract. |
| `local settings<const> = require('lib/settings')` | The importing local binding; for a const namespace, this is the compile-time alias used to resolve exported paths. |

The local declaration does not turn an ordinary imported table into a compile-time namespace and does not freeze that table's fields. Conversely, import a compile-time namespace with the const-local form shown above, rather than assuming that a plain mutable local materializes a runtime namespace object.

A compile-time namespace root cannot be used as a runtime table. Select an exported field instead. Do not pass the root as a value, return it as a table, or iterate it as though it were allocated module data.

### Static function imports

A const module may export a root function. Bind the import with a const local and call the bound name directly:

```lua
local operation<const> = require('lib/operation')
local result = operation(value)
```

A named function inside a compile-time namespace is likewise a static call target. Static exported functions are not ordinary runtime function values: do not place one in a runtime table, pass one as an ordinary callback, or return one as a runtime function value. A constant data export, on the other hand, is data and cannot itself be called.

Static function bodies operate within the static-code contract. They may perform scalar computation, use the supported typed static-memory operations, and call other static exports. They may not capture runtime outer locals or call a dynamically selected function. Runtime global reads and writes, table allocation and dispatch, object length, runtime closure creation, vararg dispatch, and dynamic string concatenation are also outside this contract.

Ordinary string constants in a static function body are not permitted. This restriction does not mean that no string value can occur: an already interned constant selected through immutable typed read-only data is a distinct permitted case. A namespace's ability to export a constant string does not make ordinary runtime string operations available to its static functions.

## Named BIOS function imports

The named BIOS function imports are:

| Module path | Const binding and call form |
| --- | --- |
| `math/sin` | `sin_turn32(angle)` |
| `string/float/decode` | `decode_float(high, low, byte_count)` |
| `gpu/system_vram_region` | `system_vram_region()` |

Each path names a root static function. Import and call them as follows:

```lua
local sin_turn32<const> = require('math/sin')
local decode_float<const> = require('string/float/decode')
local system_vram_region<const> = require('gpu/system_vram_region')

local sine = sin_turn32(angle)
local decoded = decode_float(high, low, byte_count)
local origin<const>, size<const> = system_vram_region()
```

These examples establish the import names and argument ordering. The routines' numeric conventions, returned-value meanings, and complete contracts belong to their respective routine documentation.

The module path identifies the imported function; a fixed function address or a numeric asset identifier does not. These named imports resolve directly to static BIOS call targets and do not initialize an ordinary cartridge source module. A cartridge source module cannot replace one by supplying the same path. This list does not imply that every BIOS source file or every global library table is independently available as a named import.

## The installed program environment

Before normal cartridge entry, the BIOS installs the base functions and publishes the library names `table`, `string`, `coroutine`, `lua_compiler`, `load`, `os`, and `math`. A cartridge entering through this path can use those installed bindings without installing the libraries itself.

These are ordinary public bindings. A program can change them; their initial presence does not make their values immutable. Nor does installation provide a private copy of the global environment for each cartridge.

### Ordinary globals are a name bank

Ordinary global values belong to a shared bank indexed by String names. This bank is separate from the system-global bank. It is not an ordinary Table, and accessing it is not Table indexing.

A previously unseen ordinary name begins with `nil`. When another program image registers the same ordinary name, it uses the existing shared binding; registering the name does not clear its value. Do not assume that moving between program images gives every name a new `nil` value.

The BIOS installers described here do not install `_G` or `_ENV` as global-environment Tables. The installed environment therefore does not supply `_G[name]` or replacement of `_ENV` as its name-based access interface. This is an installation statement, not an additional source-identifier or loader-environment rule.

### Accessing a global by name

Use the installed functions `getglobal` and `setglobal` to access the ordinary global bank by name.

| Call | Arguments | Results |
| --- | --- | --- |
| `getglobal(name)` | `name` must be a String. | One value: the current ordinary global value, or `nil` if the name is absent. |
| `setglobal(name, value)` | `name` must be a String. The value may be omitted, in which case it is `nil`. | No result values. |

`setglobal` writes the named binding, creating it when necessary. Writing `nil` is a write of `nil`; it is not a request to clear the whole bank. Both functions address the ordinary global bank directly, rather than a caller-supplied environment Table.

For example, `setglobal("score", 100)` makes `getglobal("score")` return `100`. A subsequent `setglobal("score")` writes `nil`, so `getglobal("score")` then returns `nil`.

### Installed names and library Tables

The base installation provides these public names:

- `next`, `type`, `setmetatable`, `getmetatable`, `rawget`, `rawset`;
- `getglobal`, `setglobal`, `select`;
- `error`, `pcall`, `xpcall`, `assert`;
- `rawequal`, `tostring`, `tonumber`, `print`, `ipairs`, `pairs`.

This is the base installation inventory, not a restriction on names that a program or module may introduce. Consult the [base reference](bios-base.md) for detailed function behavior; the two name-based global operations are specified above.

<div class="keep-together">

Several other installed globals hold ordinary library Tables. The distinction matters: `string` is a global binding, while the library Table initially held by that binding is a separate value.

| Installed name | Interface navigation |
| --- | --- |
| `table` | The Table library. See the [Table reference](bios-table.md) for its operations. |
| `string` | The completed String library Table, also registered for String indexing. See the [String reference](bios-string.md) for indexing and library behavior. |
| `coroutine` | The coroutine library Table. See [Protected calls and coroutines](coroutines.md). |
| `math` | The mathematics library Table. Names include `abs`, `pi`, and `random`; these examples identify entry points, not their numeric or random-number contracts. |
| `os` | A Table exposing `clock`, `time`, `date`, and `difftime`. These names alone do not establish desktop operating-system, filesystem, process, or civil-clock behavior. |
| `lua_compiler` | A Table containing `compile_syntax`, `syntax_factory`, and `load`, for the BIOS runtime-compilation interface. |
| `load` | Initially the same function value as `lua_compiler.load`; see the runtime-compilation boundary below. |

</div>

The `math` and `os` entries here are name navigation only. This chapter does not define their argument domains, precision, errors, random-number behavior, or timing conventions.

### Public bindings and captured dependencies

Changing a public binding does not replace every use of the corresponding operation inside the BIOS. Some installed routines retain dependencies captured during initialization; others consult public bindings when called.

The installed base routines illustrate both cases:

- `assert` uses captured primitive values for selection and error reporting.
- `pairs` uses the public `next` binding when called.
- `print` uses public `select` and `tostring`, but retains its captured console dependency.
- `tonumber` uses public `type` and `error`.

Similarly, the String library captures `table.concat` during initialization. The completed library Table is registered for String indexing. Reassigning the public `string` binding does not, by itself, register a different Table for that purpose.

These distinctions describe the dependencies above, not a general guarantee that arbitrary library replacement is safe. Keep the public binding, the Table or function value it holds, and values already retained by other routines distinct.

### Fresh system boot and execution transfer

A fresh system boot clears the execution environment, including both global-name banks, before the BIOS installs its initial environment. The normal cartridge-entry path follows that installation.

An `EXEC` transfer is different. The transfer itself does not clear the global-name banks or reinstall the BIOS. It must not be treated as a fresh global environment, a private per-cartridge environment, or a heap-reset guarantee. The fresh-system-boot behavior described here does not establish the behavior of every other reset route or cartridge lifetime.

### Runtime compilation is a separate interface

The public `load` function belongs to BIOS runtime compilation. It is not the interface that builds linked cartridge programs, and its presence does not specify the cartridge module pipeline.

The public `load` wrapper reports a protected compilation failure as `nil` followed by an error value. This wrapper behavior does not establish the failure contract of the other `lua_compiler` entries. Its source modes, environment handling, external-scope behavior, and detailed error contracts require their own reference. Do not substitute stock Lua assumptions about chunk environments or file loading for those contracts.

The firmware shell also has a separate session environment Table and a session-specific loading wrapper. That Table is not a wholesale copy of the ordinary global bank, and the shell wrapper is not the public BIOS `load` interface. Neither the shell session nor runtime compilation defines the environment of a linked cartridge program.

## Complete program: modules and ordinary globals

Start this cartridge through a fresh BIOS boot, not a second execution over a
retained global environment. It uses six complete source files. It owns a typed BSS observation
record and changes only its own `modules_manual_step` global. It does not replace
a BIOS binding, guess a RAM address or construct a device-register Table.
[Memory](memory.md#typed-byte-storage-and-address-views) defines the typed storage
and its startup initialization; [CPU](cpu.md#calls-closures-globals-and-tables)
defines ordinary values, calls, closures and globals.

Save each listing under the name shown. The nested `lib/` names are literal
module paths. The [build and observation route](../programming/getting-started.md#build-and-inspect-modules-and-globals)
supplies the complete tree, manifest and exact commands.

### Result-storage module: `results.lua`

```lua
module<const>

struct modules_manual_result
	completed: word
	counter_loads: word
	false_loads: word
	nil_loads: word
	nil_seen_from_false: word
	entry_counter_loads: word
	entry_false_loads: word
	entry_nil_loads: word
	same_module: word
	first_value: word
	second_value: word
	false_exports: word
	nil_exports: word
	initial_global_nil: word
	first_step: word
	local_shadow: word
	shadow_value: word
	global_after_shadow: word
	changed_global: word
	final_value: word
end

bss result: modules_manual_result

return { result = result }
```

### Compile-time settings: `lib/settings.lua`

```lua
module<const>

return { step = 3 }
```

### Stateful operation: `lib/counter.lua`

```lua
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.counter_loads = result.counter_loads + 1

local value = 10
local advance<const> = function(delta)
	value = value + delta * modules_manual_step
	return value
end
return { advance = advance }
```

### False export: `lib/false_export.lua`

```lua
require('lib/nil_export')
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.false_loads = result.false_loads + 1
result.nil_seen_from_false = result.nil_loads

return false
```

### Nil export: `lib/nil_export.lua`

```lua
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.nil_loads = result.nil_loads + 1

return nil
```

<div class="keep-together">

### Entry module: `entry.lua`

The first observations precede the entry's ordinary-module import assignments.
The constructors have already run during startup. A second import selects the
same retained export, including the shared counter closure or an explicit false
or nil value; export truthiness is not an initialization flag.

The counter's operation reads the ordinary global `modules_manual_step`, not
the calling block's same-named local. Changing that ordinary global affects
the operation's next call.

```lua
module<entry>

local state<const> = require('results')
local settings<const> = require('lib/settings')
local result<const>: *modules_manual_result = state.result

-- Constructors run during startup, before these entry statements.
result.entry_counter_loads = result.counter_loads
result.entry_false_loads = result.false_loads
result.entry_nil_loads = result.nil_loads

local first<const> = require('lib/counter')
local second<const> = require('lib/counter')
result.same_module = first == second and 1 or 0
result.initial_global_nil = modules_manual_step == nil and 1 or 0
modules_manual_step = 2
result.first_step = modules_manual_step
result.first_value = first.advance(settings.step)
modules_manual_step = 4
result.second_value = second.advance(4)

local false_first<const> = require('lib/false_export')
local false_second<const> = require('lib/false_export')
local nil_first<const> = require('lib/nil_export')
local nil_second<const> = require('lib/nil_export')
result.false_exports = false_first ~= nil and not false_first
	and false_second ~= nil and not false_second and 1 or 0
result.nil_exports = nil_first == nil and nil_second == nil and 1 or 0

do
	local modules_manual_step<const> = 99
	result.local_shadow = modules_manual_step
	result.shadow_value = first.advance(1)
end
result.global_after_shadow = modules_manual_step
modules_manual_step = 5
result.changed_global = modules_manual_step
result.final_value = second.advance(2)

print('Modules startup', result.entry_counter_loads,
	result.entry_false_loads, result.entry_nil_loads)
print('Modules dependency', result.nil_seen_from_false)
print('Modules sharing', result.same_module, result.first_value,
	result.second_value, result.counter_loads)
print('Modules exports', result.false_exports, result.nil_exports,
	result.false_loads, result.nil_loads)
print('Modules globals', result.initial_global_nil, result.first_step,
	result.local_shadow, result.shadow_value, result.global_after_shadow,
	result.changed_global, result.final_value)
result.completed = 1

while true do
	halt_until_irq
end
```

</div>

<div class="keep-together">

### Observations

After startup, the program prints the following five lines. Tabs separate
distinct `print` arguments:

```text
Modules startup	1	1	1
Modules dependency	1
Modules sharing	1	16	32	1
Modules exports	1	1	1	1
Modules globals	1	2	99	36	4	5	46
```

| Observation | Meaning in this program |
| --- | --- |
| Startup `1, 1, 1` | The counter, false-export and nil-export constructors have each run once before the entry records those counts. |
| Dependency `1` | The false-export constructor observes that its ordinary nil-export dependency has already run. |
| Sharing `1, 16, 32, 1` | Both counter imports select the same export. Starting at 10, the first operation adds `3 × 2`, then the second adds `4 × 4`; the constructor count remains one. |
| Exports `1, 1, 1, 1` | Both imports of the false module remain false and both imports of the nil module remain nil. Neither constructor repeats. |
| Globals `1, 2, 99, 36, 4, 5, 46` | The owned global starts nil, then becomes 2. The block's local value is 99, but the operation still uses global 4 and advances 32 to 36. Outside the block the global remains 4; after changing it to 5, the final operation advances 36 to 46. |

These observations demonstrate this program's initialization dependencies,
shared ordinary export and lexical/global distinction. They do not specify a
startup cycle budget or the behavior of the separate runtime source loader.

</div>

## Complete program: numeric loop control

Use a separate `loops_manual` cartridge for this program. Do not combine its
`results` module or entry with the preceding cartridge. The two complete files
own typed BSS observations; no numeric RAM address or device-register Table is
needed. [Memory](memory.md#typed-byte-storage-and-address-views) defines the
storage and startup initialization. The [build and observation route](../programming/getting-started.md#build-and-inspect-numeric-loops)
supplies the exact tree, manifest and commands.

The program exercises seven finite loops. The two zero-step loops that enter
their bodies end with the written `break` statements, not because the step
advances the index. Its observations do not establish a general termination
rule for arbitrary numerical inputs.

### Result storage: `results.lua`

```lua
module<const>

struct loops_manual_result
	completed: word
	header_calls: word
	header_count: word
	header_sum: word
	cached_count: word
	cached_sum: word
	changed_limit: word
	changed_step: word
	forward_count: word
	forward_sum: word
	reverse_count: word
	reverse_sum: word
	zero_empty_count: word
	zero_fixed_count: word
	zero_fixed_sum: word
	zero_equal_count: word
	zero_equal_sum: word
end

bss result: loops_manual_result

return { result = result }
```

Save the following three parts **in order as one `entry.lua`**. They are not
three independently entered modules; only the first part declares the entry.

### Entry part 1: retained header values

```lua
module<entry>

local state<const> = require('results')
local result<const>: *loops_manual_result = state.result

-- Three state-changing calls supply start, limit and step, in that order.
local header_cursor = 0
local advance_header<const> = function()
	header_cursor += 1
	return header_cursor
end
for index = advance_header(), advance_header() + 2, advance_header() - 2 do
	result.header_count += 1
	result.header_sum += index
end
result.header_calls = header_cursor

-- Changing the source locals does not replace the retained limit and step.
local limit = 4
local stride = 1
for index = 1, limit, stride do
	result.cached_count += 1
	result.cached_sum += index
	limit = 0
	stride = 7
end
result.changed_limit = limit
result.changed_step = stride

```

### Entry part 2: mutation and zero step

```lua
-- Body writes affect the same variable used by the test and update.
for index = 1, 5 do
	result.forward_count += 1
	result.forward_sum += index
	index += 1
end
for index = 5, 1, -1 do
	result.reverse_count += 1
	result.reverse_sum += index
	index -= 1
end

-- Zero uses the non-positive test. The following body is not entered.
for index = 1, 3, 0 do
	result.zero_empty_count += 1
end

-- These bodies deliberately end with break, not with progress from step 0.
for index = 3, 1, 0 do
	result.zero_fixed_count += 1
	result.zero_fixed_sum += index
	if result.zero_fixed_count == 3 then
		break
	end
end
for index = 2, 2, 0 do
	result.zero_equal_count += 1
	result.zero_equal_sum += index
	if result.zero_equal_count == 2 then
		break
	end
end

```

### Entry part 3: output and completion

```lua
print('Loops headers', result.header_calls, result.header_count,
	result.header_sum)
print('Loops cached', result.cached_count, result.cached_sum,
	result.changed_limit, result.changed_step)
print('Loops mutation', result.forward_count, result.forward_sum,
	result.reverse_count, result.reverse_sum)
print('Loops zero-empty', result.zero_empty_count)
print('Loops zero-fixed', result.zero_fixed_count, result.zero_fixed_sum)
print('Loops zero-equal', result.zero_equal_count, result.zero_equal_sum)
result.completed = 1

while true do
	halt_until_irq
end
```

<div class="keep-together">

### Numeric-loop observations

After startup, the program prints six lines; tabs separate distinct `print`
arguments:

```text
Loops headers	3	4	10
Loops cached	4	10	0	7
Loops mutation	3	9	3	9
Loops zero-empty	0
Loops zero-fixed	3	9
Loops zero-equal	2	4
```

| Observation | Meaning in this program |
| --- | --- |
| Headers `3, 4, 10` | Three state-changing calls supply start 1, limit 4 and step 1. Four visits sum to 10; the header calls are not repeated per visit. |
| Cached `4, 10, 0, 7` | Changing the source limit and step locals to 0 and 7 does not replace the retained 4 and 1. The body still visits 1 through 4. |
| Mutation `3, 9, 3, 9` | The ascending loop visits 1, 3, 5; the descending loop visits 5, 3, 1. Body writes affect the variable subsequently tested and updated. |
| Zero-empty `0` | With start 1, limit 3 and step 0, the body is not entered. |
| Zero-fixed `3, 9` | With start 3, limit 1 and step 0, three visits retain index 3 until the explicit break. |
| Zero-equal `2, 4` | With start and limit both 2 and step 0, two visits retain index 2 until the explicit break. |

</div>

## Complete program: generic iteration

Use a separate `iterators_manual` cartridge. Its two complete files are not
additional modules in either preceding example. The result module owns typed
BSS under the [Memory storage contract](memory.md#typed-byte-storage-and-address-views).
Follow the [build and observation route](../programming/getting-started.md#build-and-inspect-generic-iteration)
for the exact project tree, manifest and commands.

The iterator returns `false, 10`, then `2, 20`, then `nil, 999`. Three loop
variables request a third result position. The body also writes the first
visible variable, allowing its value to be distinguished from the retained
iteration control.

### Iterator result storage: `results.lua`

```lua
module<const>

struct iterators_manual_result
	completed: word
	iterator_calls: word
	body_count: word
	payload_sum: word
	false_key_count: word
	missing_third_count: word
	first_control: word
	second_control_false: word
	third_control: word
	visible_after_write: word
	stop_payload: word
end

bss result: iterators_manual_result

return { result = result }
```

### Iterator entry: `entry.lua`

```lua
module<entry>

local storage<const> = require('results')
local result<const>: *iterators_manual_result = storage.result

local context<const> = { calls = 0 }
local iterator<const> = function(state, control)
	state.calls += 1
	if state.calls == 1 then
		result.first_control = control
		return false, 10
	elseif state.calls == 2 then
		result.second_control_false = control ~= nil and not control and 1 or 0
		return 2, 20
	end
	result.third_control = control
	result.stop_payload = 999
	return nil, 999
end

for key, value, missing in iterator, context, 0 do
	result.body_count += 1
	result.payload_sum += value
	if not key then
		result.false_key_count += 1
	end
	if missing == nil then
		result.missing_third_count += 1
	end
	key = 99
	result.visible_after_write += key
end
result.iterator_calls = context.calls

print('Iter calls', result.iterator_calls, result.body_count, result.payload_sum)
print('Iter controls', result.first_control, result.second_control_false,
	result.third_control)
print('Iter values', result.false_key_count, result.missing_third_count,
	result.visible_after_write, result.stop_payload)
result.completed = 1

while true do
	halt_until_irq
end
```

<div class="keep-together">

### Iterator observations

After startup, the program prints:

```text
Iter calls	3	2	30
Iter controls	0	1	2
Iter values	1	2	198	999
```

| Observation | Meaning in this program |
| --- | --- |
| Calls `3, 2, 30` | Three calls produce two body visits. Payloads 10 and 20 sum to 30; first result `false` permits a visit, while `nil` stops before another visit. |
| Controls `0, 1, 2` | The iterator sees Number 0, then `false` (flag 1), then Number 2. Writing the first visible variable to 99 does not change the next control. |
| Values `1, 2, 198, 999` | One false-valued key reaches the body. The missing third result is nil on both visits. The body sees its written 99 twice, sum 198. Terminal payload 999 is produced with nil but never added to the payload sum. |

</div>
