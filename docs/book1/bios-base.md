# BIOS base services

The installed BIOS supplies the twelve globals in this chapter before cartridge
execution. They need no cartridge import. They check and convert language values,
traverse Tables, select argument tuples, access ordinary globals and produce
diagnostic text. They are not a second set of device-register ports.

**CPU and BLua32 instruction reference** defines language values, Number
arithmetic and ordinary calls. **Memory and program storage** defines typed byte
storage, module declarations and startup. **Protected calls and coroutines**
defines `error`, `pcall`, `xpcall` and the `coroutine` interface. **System control
and timing** defines the raw diagnostic interface and retained fault report.
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

This call succeeds and returns exactly four values: `0`, `'kept'`, `nil`, and `7`. For counting or selecting a multiple-result sequence, see **Traversal, argument selection, globals, and output**.

<section class="keep-together">

On failure, the presence of a tail argument determines the error value:

| Arguments after the condition | Raised value |
| --- | --- |
| None | The String `assertion failed!` |
| One or more | The first tail value, unchanged |

</section>

Consequently, `assert(false, nil)` raises `nil`, whereas `assert(false)` raises `assertion failed!`. A supplied `false`, Number, Table, or other non-String value is also raised as that value, not converted to a message. Later tail arguments are not additional error values. Error interception and propagation are described in **Protected calls and coroutines**.

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

The String-value check therefore precedes base arithmetic and range checking. There is no separate base-type check before `base // 1`: do not treat the three literal errors as an exhaustive diagnostic catalogue for every possible base value, or assume a String-to-Number coercion for the base. The function's `type` and explicit error operations resolve their ordinary globals when called; the contracts here describe those globals as installed. See **Protected calls and coroutines** for error handling.

</section>

#### Arithmetic and execution cost

The explicit-base parser accumulates each digit as `value * base + digit`, using Number arithmetic. Decimal integer accumulation starts at `0` and processes digits left to right as `value = value * 10 + digit`. Fractional scanning starts with divisor `10`; each digit contributes `digit / divisor` to the current value, after which the divisor is multiplied by `10`. It does not collect all fractional digits for one final division. Exponent magnitude likewise starts at `0` and accumulates left to right as `exponent = exponent * 10 + digit`. Its signed magnitude controls repeated multiplication or division by ten, changing the exponent by one step each time. After scaling and successful trailing-whitespace/end validation, the decimal parser applies the leading sign as `sign * value`. These successive operations are not a single ideal decimal conversion: rounding and range behavior follow the arithmetic actually performed. Exponent scaling has no iteration cap or finite-value rejection. Very large parsed exponents do not carry a termination or bounded-running-time guarantee.

There is no fixed total cycle count for `assert`, `rawequal`, `tostring`, or `tonumber`: their executed operations, result handling, conversions, and parsing work contribute to the cost. The direct `type` primitive adds one built-in cycle, separate from call costs. Its primitive metadata adds no per-argument or per-result charge; this does not establish a constant total cost for arbitrary calls or for the other functions in this section.

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

These functions address actual ordinary globals. They do not look up or assign a local or an upvalue merely because it has the same spelling, and they do not access the separate system-global namespace described in **CPU and BLua32 instruction reference**. A stored Table remains that Table rather than a copied collection. A String passed to `getglobal` or `setglobal` does not redirect the operation to that separate namespace.

The write takes effect when `setglobal` runs. An error later in the surrounding operation does not undo it. Protecting a call changes how a failure is received, not whether an earlier global write occurred; it is not a transaction around state changes. See **Protected calls and coroutines** for the failure-handling contract.

### `print(...)`

`print` writes one console field for every argument position, with one tab between adjacent positions and no leading or trailing separator. Nil arguments are counted and converted rather than omitted; a list consisting entirely of nils still has one field per argument. After the fields it ends the line. Calling `print` with no arguments also ends a line.

The function uses the current ordinary global `select` to count and select arguments, and the current ordinary global `tostring` to convert one selected value at each position. These dependencies are mutable. The field-counting and conversion behavior above describes the installed functions; replacing either dependency can change what `print` does or cause it to fail. See **Value checks and conversion** for the installed `tostring` conversion rules. The console dependency itself is captured locally rather than obtained through either of those public globals.

Console writing sends character codes through the system-print interface. Separately, it retains one-byte history entries: codes through 255 are retained unchanged, and larger codes are recorded as 63. The original code still goes to the system-print interface. Writing a field does not itself append a newline. Ending the line records newline code 10 in that history and writes 1 to the system-print-flush register. The history has capacity for 8192 one-byte entries and is distinct from the SYSTEM diagnostic queue. This is console output, not a file-stream operation or a drawing call. See **System control and timing** for the transport and presentation boundaries; a `print` call does not by itself specify when a display is presented.

On successful completion, `print` returns exactly **one nil**. Its ordinary function body falls through to the default one-nil return. This differs from the zero-result contract of `setglobal`, even though a single-result assignment receives nil from either call.

### Faults and incremental cycle charges

Keep iterator construction separate from iterator execution when handling errors. `next` checks its Table argument when called. `pairs` and `ipairs` construct their triples without checking the target; faults arise when their iterators attempt their respective traversal or indexing operations. The primitive argument faults used here have the messages `Attempted to iterate a non-table value.` and `Invalid argument.` as specified above. Ordinary indexing and calls retain their own failure behavior. See **Protected calls and coroutines** for receiving failures.

Each invocation of the direct primitive aliases `next`, `select`, `getglobal`, and `setglobal` adds **one builtin cycle**. This is an incremental primitive charge, not the total cost of a call or of the surrounding operation. Their primitive metadata adds no per-argument or per-result charge; scanning or copying multiple entries does not create an additional per-element metadata charge. `pairs`, `ipairs`, and `print` execute ordinary compiled code, including their calls, branches, indexing, conversion, and console work. Do not apply the aliases' one-cycle increment as a total cost for those functions. See **System control and timing** for the surrounding execution and timing model.

## Program: base services in an ordinary cartridge

This cartridge reads numeric text, totals a small inventory, distinguishes a
sequence prefix from a tuple, and changes its own global counter. It uses all
twelve base-service globals without importing a BIOS module. `pcall` and
`error` follow **Protected calls and coroutines**; `coroutine.running` supplies
a real Thread value for the type and text examples. No new coroutine is needed.

Save the first listing as `results.lua` and concatenate the four entry listings
in their printed order as `cart.lua`. These are the complete modules, not
excerpts. The companion README supplies the exact file assembly and manifest.

<section class="keep-together">

### Result storage

The `f64` members retain numeric results, including fractions and negative
values. The `word` members retain counts or observations encoded as 0 and 1.
A relation such as “the caught error was nil” is recorded as 1; nil itself is
not converted into a made-up memory representation. **Memory and program
storage** defines these typed fields, zeroed BSS, module declarations and
zero-based typed-array indexing. Ordinary language Tables below still use the
keys written in the source.

```lua
module<const>

struct bios_base_manual_result
	completed: word
	assert_first: f64
	assert_last: f64
	assert_count: word
	assert_hole: word
	assert_nil_error: word
	assert_default_error: word
	conversions: f64[6]
	conversion_rejected: word
	conversion_bad_base: word
	type_names_match: word
	object_labels_match: word
	identity_same: word
	identity_distinct: word
	next_key: f64
	next_value: f64
	next_done_count: word
	next_done_nil: word
	pairs_count: word
	pairs_sum: f64
	ipairs_count: word
	ipairs_sum: f64
	ipairs_after_hole: f64
	select_count: word
	select_suffix_count: word
	select_first_nil: word
	select_last: f64
	select_empty_count: word
	global_values: f64[2]
	global_error: word
	global_cleared: word
	print_count: word
end

bss result: bios_base_manual_result

return { result = result }
```

</section>

<section class="keep-together">

### Entry 1: assertions and numeric text

Zero passes `assert`. Its four results preserve the interior nil. The second
call counts that same successful tuple without packing it into a Table. A
failed assertion with an explicit nil message raises nil; leaving the message
out raises `assertion failed!`. Both are failures, so the program checks the
protected-call flag rather than treating a nil payload as success.

The six conversions exercise numeric passthrough, signed decimal exponent
text, a decimal fraction, prefixed hexadecimal, base 2 and base 36. Text with
trailing junk is rejected as nil; base 37 instead raises the caught error.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_base_manual_result = state.result

-- Zero is true; a successful assertion preserves its whole argument tuple.
local label, gap
result.assert_first, label, gap, result.assert_last = assert(0, 'kept', nil, 7)
result.assert_hole = gap == nil and 1 or 0
result.assert_count = select('#', assert(0, 'kept', nil, 7))
print('Assert values', result.assert_first, label, gap, result.assert_last)
local nil_ok<const>, nil_error<const> = pcall(assert, false, nil)
result.assert_nil_error = not nil_ok and nil_error == nil and 1 or 0
print('Assert nil error', nil_ok, nil_error)
local default_ok<const>, default_error<const> = pcall(assert, false)
result.assert_default_error = not default_ok
	and default_error == 'assertion failed!' and 1 or 0
print('Assert default', default_ok, default_error)

-- Read numeric text through the installed converter, not a cartridge parser.
result.conversions[0] = tonumber(12.5)
result.conversions[1] = tonumber('  -12.5e1  ')
result.conversions[2] = tonumber('.25')
result.conversions[3] = tonumber('0x10')
result.conversions[4] = tonumber('-101', 2)
result.conversions[5] = tonumber('z', 36)
local rejected<const> = tonumber('12x')
result.conversion_rejected = rejected == nil and 1 or 0
print('Conversions', result.conversions[0], result.conversions[1], result.conversions[2],
	result.conversions[3], result.conversions[4], result.conversions[5], rejected)
local base_ok<const>, base_error<const> = pcall(tonumber, '10', 37)
result.conversion_bad_base = not base_ok
	and base_error == 'bad argument #2 to tonumber (base out of range)' and 1 or 0
print('Invalid base', base_ok, base_error)
```

</section>

<section class="keep-together">

### Entry 2: labels, identity and traversal

The seven type names include `thread`, obtained from the running thread.
`tostring` gives the object labels `table`, `function` and `thread`, not object
addresses. `rawequal` distinguishes the same Table from a separate Table with
the same contents.

The singleton gives `next` an unambiguous pair. Advancing past it produces
exactly one nil result. The inventory example uses only a count and sum, so
its answer does not depend on the traversal order of named keys. The sequence
example stops at its first nil even though key 4 remains present. Neither loop
uses the Table-length operator to infer how many values were visited.

```lua

local shared<const> = { count = 3 }
local other<const> = { count = 3 }
local thread<const> = coroutine.running()
local names<const> = type(nil) .. '/' .. type(false) .. '/' .. type(12) .. '/'
	.. type('text') .. '/' .. type(shared) .. '/' .. type(assert) .. '/' .. type(thread)
result.type_names_match =
	names == 'nil/boolean/number/string/table/function/thread' and 1 or 0
print('Type names', names)
local labels<const> = tostring(shared) .. '/' .. tostring(assert) .. '/' .. tostring(thread)
result.object_labels_match = labels == 'table/function/thread' and 1 or 0
print('Object labels', labels)
result.identity_same = rawequal(shared, shared) and 1 or 0
result.identity_distinct = not rawequal(shared, other) and 1 or 0
print('Identity', rawequal(shared, shared), rawequal(shared, other))

-- A singleton makes next's first pair unambiguous without ordering a hash table.
local singleton<const> = { [4] = 41 }
result.next_key, result.next_value = next(singleton)
result.next_done_count = select('#', next(singleton, result.next_key))
result.next_done_nil = next(singleton, result.next_key) == nil and 1 or 0
print('Next', result.next_key, result.next_value, result.next_done_count)
local inventory<const> = { apples = 11, pears = 22, plums = 33 }
for _key, quantity in pairs(inventory) do
	result.pairs_count = result.pairs_count + 1
	result.pairs_sum = result.pairs_sum + quantity
end
print('Inventory', result.pairs_count, result.pairs_sum)
local sequence<const> = { 10, 20, nil, 90 }
for _index, quantity in ipairs(sequence) do
	result.ipairs_count = result.ipairs_count + 1
	result.ipairs_sum = result.ipairs_sum + quantity
end
result.ipairs_after_hole = sequence[4]
print('Sequence prefix', result.ipairs_count, result.ipairs_sum, result.ipairs_after_hole)
```

</section>

<section class="keep-together">

### Entry 3: tuples and an owned global

`select('#', ...)` includes nil positions. Selecting the suffix at position 2
preserves nil followed by 9; selecting position 4 of a three-value tuple gives
zero results. This empty tuple is different from `next`'s exhausted one-nil
tuple.

The program owns only `bios_base_manual_counter`. `setglobal` first writes 11;
an ordinary global-name read sees it. Inside protection, ordinary assignment
changes it to 22 before raising an error. `getglobal` still reads 22 afterward:
this protected call did not undo that write. The program finally clears its
own global by assigning nil with `setglobal`. It does not save and restore
some other program's state or replace a builtin function.

```lua

-- Count the tuple, not table entries: nil is a position, not an end marker.
result.select_count = select('#', 'skip', nil, 9)
local suffix_first<const>, suffix_last<const> = select(2, 'skip', nil, 9)
result.select_first_nil = suffix_first == nil and 1 or 0
result.select_last = suffix_last
result.select_suffix_count = select('#', select(2, 'skip', nil, 9))
result.select_empty_count = select('#', select(4, 'skip', nil, 9))
print('Select suffix', suffix_first, suffix_last)
print('Tuple counts', result.assert_count, result.select_count,
	result.select_suffix_count, result.select_empty_count)

-- This cartridge owns this one global; protection is not a transaction.
setglobal('bios_base_manual_counter', 11)
result.global_values[0] = bios_base_manual_counter
local changed_ok<const>, changed_error<const> = pcall(function()
	bios_base_manual_counter = 22
	error('counter changed')
end)
result.global_values[1] = getglobal('bios_base_manual_counter')
result.global_error = not changed_ok and changed_error == 'counter changed' and 1 or 0
print('Global writes', result.global_values[0], result.global_values[1],
	changed_ok, changed_error)
setglobal('bios_base_manual_counter', nil)
result.global_cleared = getglobal('bios_base_manual_counter') == nil and 1 or 0
print('Global cleared', getglobal('bios_base_manual_counter'))
```

</section>

<section class="keep-together">

### Entry 4: output and completion

`print` includes the nil argument, separates arguments with tabs and ends the
line. This installed ordinary function falls through with one nil result;
the surrounding `select` records its count as 1. The completion field is set
only after all observations. The final loop waits for interrupts rather than
returning from the entry module.

```lua

-- print separates arguments with tabs, including nil; its fallthrough returns one nil.
result.print_count = select('#', print('Print tuple', nil, 7))
print('Print result count', result.print_count)
result.completed = 1
while true do
	halt_until_irq
end
```

</section>

<section class="keep-together">

### Retained results

After `completed` becomes 1, inspect these fields through the typed result
view. Every listed relation word is 1; counts and numeric values keep their
actual values.

| Fields | Retained result |
|---|---|
| `assert_first`, `assert_last`, `assert_count` | 0, 7, 4 |
| `assert_hole`, `assert_nil_error`, `assert_default_error` | 1 each: interior nil; failed assertion raises nil; omitted message raises the default text |
| `conversions[0]` through `[5]` | 12.5, -125, 0.25, 16, -5, 35 |
| `conversion_rejected`, `conversion_bad_base` | 1 each: rejected text is nil; base 37 raises the shown error |
| `type_names_match`, `object_labels_match` | 1 each: the exact name and label strings shown below |
| `identity_same`, `identity_distinct` | 1 each: shared Table equal to itself, separate equal-shaped Table unequal |
| `next_key`, `next_value`, `next_done_count`, `next_done_nil` | 4, 41, 1, 1 |
| `pairs_count`, `pairs_sum` | 3, 66 |
| `ipairs_count`, `ipairs_sum`, `ipairs_after_hole` | 2, 30, 90 |
| `select_count`, `select_suffix_count`, `select_first_nil`, `select_last`, `select_empty_count` | 3, 2, 1, 9, 0 |
| `global_values[0]`, `[1]`, `global_error`, `global_cleared` | 11, 22, 1, 1 |
| `print_count`, `completed` | 1, 1 |

</section>

### Output

Assemble and run the ordinary cartridge using the companion README's diagnostic
procedure. After the startup messages, its output is exactly the following
17 lines; separators are tabs:

```text
Assert values	0	kept	nil	7
Assert nil error	false	nil
Assert default	false	assertion failed!
Conversions	12.5	-125	0.25	16	-5	35	nil
Invalid base	false	bad argument #2 to tonumber (base out of range)
Type names	nil/boolean/number/string/table/function/thread
Object labels	table/function/thread
Identity	true	false
Next	4	41	1
Inventory	3	66
Sequence prefix	2	30	90
Select suffix	nil	9
Tuple counts	4	3	2	0
Global writes	11	22	false	counter changed
Global cleared	nil
Print tuple	nil	7
Print result count	1
```
