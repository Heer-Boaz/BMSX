# BIOS base services

The installed BIOS supplies the twelve globals in this chapter before cartridge
execution. They need no cartridge import. They check and convert language values,
traverse Tables, select argument tuples, access ordinary globals and produce
diagnostic text. They are not a second set of device-register ports.

The [CPU reference](cpu.md) defines language values, Number arithmetic and
ordinary calls. [Memory and program storage](memory.md) defines typed byte
storage, module declarations and startup. [Protected calls and coroutines](coroutines.md)
defines `error`, `pcall`, `xpcall` and the `coroutine` interface.
[System control and timing](system.md) defines the diagnostic interface and
retained fault report.
The table/metatable raw-access globals are described in the CPU reference;
other installed libraries are separate interfaces.

The contracts below describe the installed bindings. These public names are
ordinary global values, not permanently reserved operations. Some BIOS functions
capture their primitive dependencies; others resolve ordinary globals at each
call, as specified below. Deliberately replacing a binding can therefore affect
other calls that use it.

## Value checks and conversion

The five globals in this section check values, compare them, or convert them to a Number or String. Their contracts use BMSX value categories, not the appearance of a value: a String containing digits is still a String until a conversion succeeds, and a Number does not become false merely because it is zero.

Calls preserve the distinction between an omitted argument and an explicitly supplied `nil` where the function counts its arguments. A missing fixed parameter receives `nil`. Results also have a count: selecting a fixed number of results truncates excess results or fills missing positions with `nil`; an expanding result position preserves the actual count. The multiple-result rules do not make every expression position expanding.

### `assert(condition, ...)`

`assert` tests the condition using BMSX truth: only `nil` and `false` are falsey. Every other value is truthy, including numeric zero and an empty String. An omitted condition is `nil` and therefore fails.

It uses captured error and argument-selection primitives. Replacing the public `error` or `select` binding does not replace those operations inside `assert`.

On success, `assert` returns the condition followed by every remaining argument, unchanged and in order. Its result count is exactly one plus the number of tail arguments. Explicit `nil` positions are retained, including trailing ones; this is not a function that returns only a Boolean or a single checked value.

```lua
local condition, message, absent, code = assert(0, 'kept', nil, 7)
```

This call succeeds and returns exactly four values: `0`, `'kept'`, `nil`, and `7`. For counting or selecting a multiple-result sequence, see [Traversal, argument selection, globals, and output](#traversal-argument-selection-globals-and-output).

<section class="keep-together">

On failure, the presence of a tail argument determines the error value:

| Arguments after the condition | Raised value |
| --- | --- |
| None | The String `assertion failed!` |
| One or more | The first tail value, unchanged |

</section>

Consequently, `assert(false, nil)` raises `nil`, whereas `assert(false)` raises `assertion failed!`. A supplied `false`, Number, Table, or other non-String value is also raised as that value, not converted to a message. Later tail arguments are not additional error values. Error interception and propagation are described in [Protected calls and coroutines](coroutines.md).

### `rawequal(left, right)`

`rawequal` returns exactly one Boolean. It uses ordinary BMSX equality directly, without conversion and without invoking an equality metamethod. Missing operands are `nil`; arguments after the two operands do not participate.

| Operand categories | Equality rule |
| --- | --- |
| Different categories | Unequal |
| `nil` and `nil` | Equal |
| Booleans | Equal when they have the same Boolean value |
| Numbers | Numeric equality; NaN is unequal, and positive and negative zero are equal |
| Strings | Compare their scalar String IDs |
| Built-in functions | Compare their scalar function IDs |
| Tables, closures, and Threads | Compare reference identity within the same category |

The public type name `function` covers both closures and built-in functions, but that shared label does not make different callable categories equal. Likewise, a Number and a String spelling that Number are unequal. Distinct Tables are unequal even when their entries match; two references to the same Table are equal. No copy, structural comparison, or text conversion is performed.

<section class="keep-together">

### `type(value)`

`type` returns exactly one String naming the value's category. Omitting the argument is equivalent to passing `nil`; further arguments are ignored. The complete set of returned labels is:

| Value category | Result |
| --- | --- |
| Nil | `'nil'` |
| False or True | `'boolean'` |
| Number | `'number'` |
| String | `'string'` |
| Thread | `'thread'` |
| Table | `'table'` |
| Closure or built-in function | `'function'` |

</section>

These are exact, lowercase labels. In particular, Boolean values do not have separate `'true'` and `'false'` type labels, and the result does not distinguish the two callable categories. The function classifies the value itself rather than attempting to parse or convert it.

### `tostring(value)`

`tostring` returns exactly one String. Its operation is the ordinary concatenation `'' .. value`, using BMSX scalar-to-String conversion; it does not perform a separate `__tostring` lookup. An omitted argument converts as `nil`. Further arguments are not parameters and do not affect the result.

| Value | String contents |
| --- | --- |
| `nil` | `nil` |
| `false` | `false` |
| `true` | `true` |
| String | Its contents, unchanged |
| Thread | `thread` |
| Table | `table` |
| Closure or built-in function | `function` |
| Number NaN | `nan` |
| Negative infinity | `-inf` |
| Positive infinity | `inf` |

The category words are literal text, not addresses, names, or structural dumps. Number conversion uses the CPU chapter's **default Number-to-String formatter**. Positive and negative zero are preserved as `0` and `-0`; exact integer magnitudes strictly below `1000000` use the formatter's integer shortcut. Consult that formatter's contract for finite normalization and rounding. `tostring` has no formatting argument and does not offer a precision or notation selector.

### `tonumber(value [, base])`

`tonumber` returns exactly one Number on a successful conversion, or exactly one `nil` when a supported parse fails. Some explicit-base argument errors raise a value instead of returning normally. The omitted-base and explicit-`nil`-base forms follow the same rules:

| `value` category, with no nonnil base | Result |
| --- | --- |
| Number | The original Number, unchanged |
| String | The parsed Number, or `nil` if parsing fails |
| Any other category, including an omitted value | `nil` |

An explicit nonnil base selects a different contract: the value must be a String, and the base must pass the checks below. A Number value is not accepted by this form even when it could be returned unchanged without a base. Arguments after `base` are not parameters.

#### Character and token rules

Both parsing forms recognize whitespace only as character code `32` or codes `9` through `13`, inclusive. Leading and trailing whitespace are permitted. Whitespace inside the numeral is not skipped. A sign, when allowed, is one leading `+` or `-` after leading whitespace.

The digit alphabet is ASCII `0` through `9`, then `A` through `Z` or `a` through `z`. Decimal digits have values zero through nine; either letter case maps to values ten through thirty-five. A digit is usable only when its value is less than the selected base. Other characters are not digits.

A successful parse must consume the entire String apart from the permitted leading and trailing whitespace. A missing required digit, an invalid digit, or any remaining non-whitespace character makes parsing return `nil`. There is no successful-prefix result that silently discards the rest of a String.

#### Default String form

After leading whitespace and an optional sign, an initial `0x` or `0X` selects an integer hexadecimal form. It requires at least one hexadecimal digit, accumulates those digits in base sixteen, and then accepts only trailing whitespace and the end of the String. This form has no hexadecimal fractional part or hexadecimal exponent.

Without that prefix, the form is decimal. It contains decimal integer digits, an optional decimal point and decimal fractional digits, or a decimal point followed by fractional digits. At least one digit must occur across the integer and fractional parts: `.25`, `12.`, and `12.25` are accepted forms, but a bare decimal point is not. A leading zero without the hexadecimal prefix does not select another base.

The decimal form may end with an exponent introduced by `e` or `E`. The exponent may have one `+` or `-` sign and must have at least one decimal digit. Only trailing whitespace may follow it. Thus neither an exponent marker alone nor an exponent sign without digits completes a numeral.

| Part | Default decimal | Default prefixed hexadecimal |
| --- | --- | --- |
| Leading whitespace | Permitted | Permitted |
| Leading sign | Optional | Optional, before the prefix |
| Prefix | None | `0x` or `0X` |
| Required digits | At least one across integer and fractional parts | At least one hexadecimal digit |
| Fraction | Optional decimal point and decimal digits | Not supported |
| Exponent | Optional `e` or `E`, optional sign, required decimal digits | Not supported |
| End | Trailing whitespace, then end of String | Trailing whitespace, then end of String |

#### Explicit-base String form

The supported bases are integer Numbers from `2` through `36`, inclusive. After leading whitespace and an optional sign, this form reads one or more digits valid for that base, then permits only trailing whitespace and the end of the String. It does not accept a fractional point or provide a separate exponent syntax.

No prefix is stripped in the explicit-base form. In particular, selecting base sixteen does not give `0x` or `0X` special treatment: their characters are processed by the same digit rules as every other character. Letters such as `e` are digits when their values fit the chosen base, not exponent markers. Use the default form, rather than an explicit base, when requesting decimal fractions or decimal exponents.

<section class="keep-together">

#### Argument-check order and errors

For a nonnil base, the installed function performs these operations in order:

1. Check that `value` is a String. Otherwise, raise the exact String `bad argument #1 to tonumber (string expected)`.
2. Compute `integer_base = base // 1`. If `integer_base` differs from `base`, raise the exact String `bad argument #2 to tonumber (integer expected)`.
3. Require `integer_base` to be between `2` and `36`, inclusive. Otherwise, raise the exact String `bad argument #2 to tonumber (base out of range)`.
4. Parse the String using that base, returning a Number or `nil`.

The String-value check therefore precedes base arithmetic and range checking. There is no separate base-type check before `base // 1`: do not treat the three literal errors as an exhaustive diagnostic catalogue for every possible base value, or assume a String-to-Number coercion for the base. The function's `type` and explicit error operations resolve their ordinary globals when called; the contracts here describe those globals as installed. See [Protected calls and coroutines](coroutines.md) for error handling.

</section>

#### Arithmetic and execution cost

The explicit-base parser accumulates each digit as `value * base + digit`, using Number arithmetic. Decimal integer accumulation starts at `0` and processes digits left to right as `value = value * 10 + digit`. Fractional scanning starts with divisor `10`; each digit contributes `digit / divisor` to the current value, after which the divisor is multiplied by `10`. It does not collect all fractional digits for one final division. Exponent magnitude likewise starts at `0` and accumulates left to right as `exponent = exponent * 10 + digit`. Its signed magnitude controls repeated multiplication or division by ten, changing the exponent by one step each time. After scaling and successful trailing-whitespace/end validation, the decimal parser applies the leading sign as `sign * value`. These successive operations are not a single ideal decimal conversion: rounding and range behavior follow the arithmetic actually performed. Exponent scaling has no iteration cap or finite-value rejection. Very large parsed exponents do not carry a termination or bounded-running-time guarantee.

There is no fixed total cycle count for `assert`, `rawequal`, `tostring`, or `tonumber`: their executed operations, result handling, conversions, and parsing work contribute to the cost. `type` adds one cycle, separate from call and return instruction costs, with no additional per-argument or per-result charge.

## Traversal, argument selection, globals, and output

The installed base functions in this section provide table traversal, access to argument lists and ordinary globals, and console output. They are ordinary global function values. A call uses the value resolved for that name; the name alone does not reserve an operation independently of its current binding. The dependencies described below matter when a program replaces one of these globals.

Result counts are part of each contract. A function returning one nil is different from a function returning no values, even though assigning either result to one variable produces nil. A fixed-result context truncates excess results or supplies missing results as nil. An open-result context retains the actual count. Calls do not expand to all their results in every expression position; an expanding final argument can pass the complete result list to another call.

<section class="keep-together">

### `next(table [, key])`

`next` traverses entries stored in a Table. Its first argument must be a Table; an omitted argument, nil, or another value faults with `Attempted to iterate a non-table value.` The optional second argument is the continuation key. Omitting it is the same as supplying nil. The key is used in its existing value representation, without a conversion by this function. Arguments after the second are unused.

</section>

A successful step returns exactly two results, `(key, value)`. Array keys are Numbers, and the returned value retains its stored representation. Exhaustion returns exactly **one nil**, not zero results and not a pair of nils. Starting with a nil key visits live array slots in ascending order, followed by live hash slots, according to the Table's current storage. This is not a guarantee of insertion order or a sorted ordering of all keys.

Continuation follows that storage as well. A continuation key identifying an array slot within the current capacity resumes after that slot, even when its value is now nil. A non-array continuation key not recognized in the Table's current continuation storage ends traversal rather than raising an invalid-key error. Some removed mappings leave recognizable continuation nodes; an absent live mapping alone does not prove that its key will terminate traversal. These rules do not establish a mutation-safe traversal order or a guarantee across changes to Table storage. In particular, do not turn the array-first traversal rule into a conclusion about Table length.

`next` visits stored entries, not values supplied by inherited ordinary indexing. Its returned key is also the continuation control for a subsequent step. Test that key for nil when detecting exhaustion: false is not an exhaustion marker.

### `pairs(target)`

`pairs` is an iterator factory. It returns exactly three results, `(next, target, nil)`, using the **current ordinary global `next`** as its first result. It does not validate the target while constructing this triple and does not inspect `__pairs`. Consequently, with the installed `next`, an unsuitable target faults when iteration is attempted, not when `pairs(target)` returns. Replacing global `next` changes the iterator supplied by later calls to `pairs`.

A generic `for` obtains three values from its iterator expression: iterator, state, and initial control. Each step calls the iterator with `(state, control)`. The loop ends only when the first result is nil; false does not end it. Otherwise that first result becomes the next control. With the installed `next`, this mechanism traverses the stored entries described above. `pairs` adds no separate ordering or mutation guarantee.

### `ipairs(target)`

`ipairs` also returns exactly three results: `(ipairs_iterator, target, 0)`. It does not check the target when constructing the triple. Unlike `pairs`, its first result is a captured local iterator function rather than a lookup of a global iterator name. It does not consult `__ipairs`.

Each iterator step computes `next_index = index + 1` and reads `target[next_index]` using ordinary indexing. If the read produces nil, the step returns exactly one nil. Otherwise it returns exactly two results, `(next_index, value)`. A false value is therefore an ordinary sequence element and is returned, not treated as a stopping condition. A nil encountered at an index stops this traversal even when later indexes contain values.

Ordinary indexing is important here: the step is not a raw Table-entry lookup. A Table can supply a value through its ordinary metatable index resolution, and such a value can keep `ipairs` running where a stored entry alone would not. By contrast, `next` traverses actual storage. Ordinary indexing also accepts a String through its String-index table; that acceptance is not a promise that numeric String indexes return characters or substrings. A value that cannot be indexed faults when the iterator step reaches the read, rather than during construction of the `ipairs` triple.

`ipairs` never reads Table length. Its limit is the first nil returned by successive ordinary reads, not a length captured before iteration or recomputed at each step. Changes affecting those reads can affect subsequent steps; this is not a separate mutation-safe sequence traversal contract.

<section class="keep-together">

### `select(selector, ...)`

`select` operates on the arguments after its selector. The exact String selector `'#'` returns exactly one Number: the number of those arguments, including every nil position. An omitted selector, nil, any other String, or any other non-Number selector faults with `Invalid argument.` Numeric selectors take a different path; they are not required to be integer-valued before conversion.

A numeric selector is converted to a signed 32-bit register word: discard its fractional part toward zero, reduce the resulting integer modulo 2^32, then interpret bit 31 as the sign bit. NaN and either infinity convert to zero. Let `s` be that converted value and `count` the number of remaining arguments. If `s` is negative, its starting position is `count + s + 1`; otherwise its starting position is `s`. The selected suffix is then restricted to argument positions `1` through `count`. Conversion precedes both the negative-offset calculation and the bounds filtering.

| Converted selector | Results |
| --- | --- |
| `1` through `count` | That argument and every following argument |
| `-1` | The final argument, when one exists |
| `-count`, for a nonempty argument list | All arguments |
| `0`, or a value more negative than `-count` | All arguments |
| A positive value greater than `count` | Zero results |

</section>

The selected values are returned unchanged, including intervening or trailing nils. Selecting from an empty argument list produces zero values, whereas selecting `'#'` from it produces one Number, zero. The zero and overly negative cases are not range errors: filtering leaves the complete argument list. The overly large positive case is genuinely an empty result list, not a single nil; fixed-result assignment can conceal that distinction by supplying nil to the receiving variable.

### `getglobal(name)` and `setglobal(name, value)`

`getglobal` requires a String name without coercion. An omitted name or a non-String name faults with `Invalid argument.` It returns exactly one value: the current value of the named ordinary global, or nil if the name is unknown. Arguments after the name are unused. This is a live read, not a captured copy of a global's value from an earlier point in execution.

`setglobal` requires the same uncoerced String name and uses the same argument fault for an omitted or non-String name. It writes its second argument unchanged to that ordinary global. Omitting the second argument writes nil; later arguments are unused. A previously unknown name receives an ordinary global slot, including when the value written is nil. The function itself returns **zero results**. A caller requesting one result nevertheless receives nil through normal result padding.

These functions address actual ordinary globals. They do not look up or assign a local or an upvalue merely because it has the same spelling, and they do not access the separate system-global namespace described in [CPU reference](cpu.md). A stored Table remains that Table rather than a copied collection. A String passed to `getglobal` or `setglobal` does not redirect the operation to that separate namespace.

The write takes effect when `setglobal` runs. An error later in the surrounding operation does not undo it. Protecting a call changes how a failure is received, not whether an earlier global write occurred; it is not a transaction around state changes. See [Protected calls and coroutines](coroutines.md) for the failure-handling contract.

### `print(...)`

`print` writes one console field for every argument position, with one tab between adjacent positions and no leading or trailing separator. Nil arguments are counted and converted rather than omitted; a list consisting entirely of nils still has one field per argument. After the fields it ends the line. Calling `print` with no arguments also ends a line.

The function uses the current ordinary global `select` to count and select arguments, and the current ordinary global `tostring` to convert one selected value at each position. These dependencies are mutable. The field-counting and conversion behavior above describes the installed functions; replacing either dependency can change what `print` does or cause it to fail. See [Value checks and conversion](#value-checks-and-conversion) for the installed `tostring` conversion rules. The console dependency itself is captured locally rather than obtained through either of those public globals.

Console writing sends character codes through the system-print interface. Separately, it retains one-byte history entries: codes through 255 are retained unchanged, and larger codes are recorded as 63. The original code still goes to the system-print interface. Writing a field does not itself append a newline. Ending the line records newline code 10 in that history and writes 1 to the system-print-flush register. The history has capacity for 8192 one-byte entries and is distinct from the SYSTEM diagnostic queue. This is console output, not a file-stream operation or a drawing call. See [System control and timing](system.md) for the transport and presentation boundaries; a `print` call does not by itself specify when a display is presented.

On successful completion, `print` returns exactly **one nil**. Its ordinary function body falls through to the default one-nil return. This differs from the zero-result contract of `setglobal`, even though a single-result assignment receives nil from either call.

### Faults and incremental cycle charges

Keep iterator construction separate from iterator execution when handling errors. `next` checks its Table argument when called. `pairs` and `ipairs` construct their triples without checking the target; faults arise when their iterators attempt their respective traversal or indexing operations. The primitive argument faults used here have the messages `Attempted to iterate a non-table value.` and `Invalid argument.` as specified above. Ordinary indexing and calls retain their own failure behavior. See [Protected calls and coroutines](coroutines.md) for receiving failures.

Each invocation of `next`, `select`, `getglobal`, or `setglobal` adds **one cycle**, with no additional per-argument or per-result charge. This increment is separate from call and return instructions and the surrounding operation. `pairs`, `ipairs`, and `print` execute ordinary instructions, including their calls, branches, indexing, conversion, and console work. The one-cycle increment is not their total call cost. See [System control and timing](system.md) for the execution and timing model.

## Programming examples

The following sequences use the installed globals directly. They illustrate
conversion, traversal, argument tuples and console output.

### Assertions and numeric text

A successful assertion preserves its full argument tuple. A failed assertion
with an explicit nil message is still a failure: use the protected-call flag,
not the error value, to distinguish it from success.

```lua
local first, label, gap, last = assert(0, 'kept', nil, 7)
-- first = 0, label = 'kept', gap = nil, last = 7.
local count = select('#', assert(0, 'kept', nil, 7)) -- 4
local ok, value = pcall(assert, false, nil)         -- false, nil
local default_ok, message = pcall(assert, false)
-- default_ok = false; message = 'assertion failed!'.
```

Numeric text is accepted only when the entire numeral and permitted trailing
whitespace are consumed. A malformed numeral returns nil; an invalid explicit
base raises an error instead.

```lua
local unchanged = tonumber(12.5)      -- 12.5
local decimal = tonumber(' -12.5e1 ') -- -125
local fraction = tonumber('.25')     -- 0.25
local hex = tonumber('0x10')          -- 16
local binary = tonumber('-101', 2)    -- -5
local base36 = tonumber('z', 36)      -- 35
local rejected = tonumber('12x')     -- nil
local ok, message = pcall(tonumber, '10', 37)
-- false, 'bad argument #2 to tonumber (base out of range)'.
```

### Identity and traversal

Equal-looking Tables remain distinct objects. Their text labels describe the
category, not their contents or identity.

```lua
local inventory = {apples = 11, pears = 22, plums = 33}
local same = inventory
local other = {apples = 11, pears = 22, plums = 33}
local shared = rawequal(inventory, same)   -- true
local distinct = rawequal(inventory, other) -- false
local category = type(inventory)          -- 'table'
local label = tostring(inventory)         -- 'table'
local total = 0
for name, quantity in pairs(inventory) do
    total = total + quantity
end
-- total is 66, independently of the order of named keys.
```

`ipairs` stops at the first nil read; it does not search ahead for another
populated key. `next` instead visits stored mappings and returns one nil when
exhausted.

```lua
local sequence = {10, 20, nil, 90}
local total = 0
for index, quantity in ipairs(sequence) do
    total = total + quantity
end
-- total is 30; sequence[4] remains 90.
local singleton = {[4] = 41}
local key, value = next(singleton)       -- 4, 41
local finished = next(singleton, key)    -- nil
local result_count = select('#', next(singleton, key)) -- 1
```

### Tuples and globals

Count tuple positions with `select`, not Table length. An empty selected suffix
has no results; a suffix beginning with nil still contains that position.

```lua
local count = select('#', 'skip', nil, 9)             -- 3
local first, last = select(2, 'skip', nil, 9)           -- nil, 9
local suffix_count = select('#', select(2, 'skip', nil, 9)) -- 2
local empty_count = select('#', select(4, 'skip', nil, 9))  -- 0
```

For a global owned by the cartridge, both a global-name expression and
`getglobal` see writes made with `setglobal`. Protection does not reverse an
earlier write.

```lua
setglobal('score_counter', 11)
local before = score_counter -- 11
local ok, message = pcall(function()
    score_counter = 22
    error('counter changed')
end)
local after = getglobal('score_counter') -- 22, despite the error
setglobal('score_counter', nil)
```

### Console output

```lua
print('Score', nil, 7)
```

This produces three fields, `Score`, `nil` and `7`, separated by tabs, then ends
the line. `select('#', print())` ends an empty line and returns 1: the successful
`print` result is one nil, not an empty tuple.
