# BIOS table library

The installed `table` global provides six operations on ordinary language
Tables. No cartridge import is required. Use it to preserve argument tuples,
edit indexed sequences, join values into text, expand indexed values into
results, and sort a sequence in place. It is not a byte-storage interface or a
device-register bank. Typed arrays in **Memory and program storage** are a
different representation; their storage index zero is not the first sequence
key described here.

| Interface | Purpose | Successful results |
| --- | --- | --- |
| `table.pack(...)` | Preserve values and their supplied count | One new Table |
| `table.insert(target, value)` | Append at the maintained length plus one | One nil |
| `table.insert(target, position, value)` | Shift and insert at a numeric key | One nil |
| `table.remove(target [, position])` | Retain one value, shift and clear the old tail | One value, possibly nil |
| `table.concat(target [, separator [, start [, end]]])` | Join an inclusive numeric-key interval | One String |
| `table.unpack(target [, start [, end]])` | Expand an inclusive numeric-key interval | Selected values, or zero results |
| `table.sort(target [, compare])` | Reorder the maintained sequence in place | One nil |

These result counts are part of the interface. An ordinary bare return or
fallthrough produces one nil; that is not the zero-result tuple returned by an
empty `unpack` interval. **BIOS base services** explains `select` and result
adjustment. **Protected calls and coroutines** explains interception of an
error value, including nil, without undoing earlier writes.

## Tables, lengths and visible effects

Sequence keys start at one. Zero and negative numeric keys remain ordinary
Table keys; the insertion and removal routines do not convert them into
positions counted from the end. The relative-endpoint rule belongs only to
`concat` and `unpack`.

In the following procedures, **L** means the Table's maintained length,
`#target`, captured by that call. It is not the number of all mappings, the
greatest numeric key, a count of metatable-supplied entries, or a tuple's `n`
field. [CPU — Stored length](cpu.md#stored-length) defines the maintained length
and Table operations. A count stored by the cartridge is a separate value;
use the explicit `pack`/`unpack` recipe when nil positions must be preserved.

Element reads are ordinary Table indexing: a missing own mapping can be
supplied by a Table-valued `__index` chain. Writes go directly to the target;
they do not redirect through `__newindex`. Assigning nil removes the target's own
mapping; it does not mask a mapping inherited through `__index`. A read can therefore obtain an inherited value that a later write
copies into an own mapping. The length snapshot does not count those inherited
values.

These interfaces are intended for Table targets, but they do not begin with a
Table-only argument check. For a String target, ordinary length is a codepoint
count and reads use the shared String-index Table, not character positions.
A reached assignment to a String raises the shared assignment error. The CPU
reference defines those value-category operations; do not use `unpack` as a
String-to-character conversion.

Insert, remove and sort write the caller's Table directly, in the stated
order. There is no deferred commit or restoration on error. Pack creates a new
Table; concat and unpack do not themselves assign into the target. A callback
or a deliberately replaced public dependency can still have its own effects.
The library's public fields and the `select`/`tostring` globals it uses are
ordinary mutable bindings, not permanently reserved operations.

The functions execute ordinary instructions. Loops, tuple forwarding,
conversions, temporary Strings and comparison callbacks contribute work; a
function call is not a single constant-cycle hardware operation. The CPU
reference supplies instruction charges. These interfaces do not replace IRQ
setup or an interrupt wait.

## Packing and reading table ranges

### `table.pack`

```text
table.pack(...) -> packed
```

`table.pack` returns exactly one new ordinary Table. Its `n` field records the number of supplied arguments, including interior and trailing `nil` arguments. Arguments occupy their corresponding integer positions starting at 1; a `nil` argument leaves no mapping at that position.

```lua
local packed = table.pack(10, nil, 30, nil)
-- packed.n is 4; positions 2 and 4 read as nil.
local empty = table.pack()
-- empty.n is 0.
```

The `n` field is an ordinary, mutable String-keyed field, not a special length property. `table.insert`, `table.remove`, `table.sort`, `table.concat`, and `table.unpack` neither maintain it nor automatically use it. To read the entire packed argument list, supply `packed.n` explicitly as the end bound.

Packing uses the current global `select`, rather than a captured copy. The argument-count behavior described here assumes the installed `select`.

### Selecting a range

`table.unpack` and `table.concat` read `#target` at the start of every call, even when both bounds are explicit. The resulting value is `L`. An omitted or explicitly `nil` start bound means 1; an omitted or explicitly `nil` end bound means `L`. Neither function discovers a packed Table's `n` field.

For each explicit, non-`nil` bound, first compute `q = bound // 1`. This is floor division, not truncation toward zero. Normalize that value as follows:

| Value of `q` | Start bound | End bound |
|---|---:|---:|
| Positive | `q` | `q` |
| Negative | `L + q + 1` | `L + q + 1` |
| Zero or NaN | `1` | `L` |

<section class="keep-together">

For example, when `L` is 4:

| Supplied start, end | Selected start, end |
|---|---|
| `-3, -1` | `2, 4` |
| `0, 0` | `1, 4` |
| `1.9, 2.9` | `1, 2` |

</section>

A non-`nil`, nonnumber bound, including a numeric-looking String, produces NaN in the floor division; it is not parsed as a number. NaN is neither positive nor negative, so it normalizes like zero: to 1 for a start bound or `L` for an end bound. There is no table-library argument error for this case.

Bounds are not clamped to the default interval. The selected interval is inclusive and is empty when the normalized end precedes the normalized start. No finite-value or range-size cap is applied. Very large or infinite endpoints have no termination or resource-use guarantee.

### `table.unpack`

```text
table.unpack(target [, start [, end]]) -> ...
```

`table.unpack` reads the selected positions in ascending order. A completed call returns one result for every selected position, including positions that read as `nil`. A single-position interval therefore returns one result even when that result is `nil`. An empty interval returns zero results, not one `nil`.

With `packed` from the earlier example, these calls distinguish the result counts:

```lua
select('#', table.unpack(packed, 1, packed.n)) -- 4
select('#', table.unpack(packed, 2, 2))        -- 1
select('#', table.unpack(packed, 3, 2))        -- 0
```

Keep the call in a multiple-result context when every result matters, as in the final argument to `select` above. A fixed-size assignment discards excess results and fills missing values with `nil`; it does not preserve a result count on its own.

The reads use ordinary indexing. An explicit positive interval can therefore read metatable-supplied mappings beyond `L`, but inherited entries do not extend the default interval.

Unpacking uses a recursive call chain whose depth grows linearly with the number of selected positions, returning successively wider result lists. It has no result-count or recursion cap of its own. Empty-range handling calls the current global `select` with argument 1; its zero-result behavior assumes the installed `select`.

### `table.concat`

```text
table.concat(target [, separator [, start [, end]]]) -> text
```

`table.concat` returns exactly one String, joining the selected positions in ascending order without changing the target. Each position is read by ordinary indexing. A `nil` value contributes an empty String; every other value is converted with the current global `tostring`. Separators remain between adjacent positions even when one or both positions read as `nil`.

An omitted or explicitly `nil` separator is the empty String. Any other separator is converted with `tostring`, so the installed `tostring` accepts values other than Strings here as well. This conversion happens before the selected values are read, even for a single-position interval where no separator is inserted. An empty interval instead returns an empty String before converting the separator or reading any positions.

```lua
table.concat(packed, '|', 1, packed.n) -- "10||30|"
table.concat({true, {}, nil, 7}, false, 1, 4)
-- "truefalsetablefalsefalse7" with the installed tostring.
```

These conversions use the live global `tostring`, not a permanently captured formatter. Replacing it can change both separator and value conversion.

The recursive join uses `(first + last) // 2` as its midpoint and combines the two parts with the separator. For intervals where the midpoint arithmetic keeps dividing each nonsingleton range into smaller ranges, its call tree is balanced; very large finite bounds can lose that progress through Number rounding. Intermediate joins produce Strings; balanced recursion does not provide a fixed execution-time or peak-allocation guarantee.

## `table.insert`

| Call | Effect | Successful return |
| --- | --- | --- |
| `table.insert(target, value)` | Assigns `value` to `target[#target + 1]`. | One `nil` value. |
| `table.insert(target, position, value, ...)` | Inserts at `position // 1`, shifting the selected keys upward as described below. Arguments after `value` are ignored. | One `nil` value. |

Exactly one argument after `target` selects the append form. A lone explicit `nil` therefore means “append `nil`,” not “position omitted.” Every other trailing argument count selects the positional form. The direct-call signature requires a second argument, but an indirect call such as `pcall(table.insert, target)` can reach the positional form with no trailing arguments; both selected arguments are then `nil`, so the position arithmetic produces NaN. With a separate value, an explicit `nil` position is still passed to `// 1`.

Use a finite numeric position. This arithmetic does not parse numeric Strings, and a nonnumeric position produces NaN rather than an upfront library argument error. With a NaN position, the descending shift loop has no comparison-driven exit: it can make earlier shift writes without reaching the final insertion. A reached fault or other interruption is separate from normal completion.

For a positional insertion with a finite numeric position:

1. Compute `p = position // 1`, then take the length snapshot `L`.
2. For `i = L, L - 1, …, p`, in that descending order, assign `target[i + 1] = target[i]`.
3. Assign `target[p] = value`.

The position is not checked or clamped. Zero and negative positions name those actual keys; they do not count backward from the end. If `p > L`, no keys are shifted and the only assignment is at `p`. A fractional position is rounded downward by `// 1`, so `5.9` selects key `5`.

For example, starting with the plain table `{10, 20}` and no key `0`:

```lua
local values = {10, 20}
table.insert(values, 0, 7)
-- values[0] is 7; values[1] is nil;
-- values[2] is 10; values[3] is 20.
```

<section class="keep-together">

An insertion beyond the selected prefix leaves a gap rather than filling it:

```lua
local values = {10, 20}
table.insert(values, 5.9, 99)
-- values[1] is 10; values[2] is 20; values[5] is 99.
-- Keys 3 and 4 are absent.
```

</section>

Use the keys actually written when reasoning about these examples; insertion does not promise a universal resulting-length formula. Assigning `nil`, either directly or while shifting, deletes the destination mapping. `table.insert` does not update a field named `n` and does not return a length or the modified table.

## `table.remove`

| Call | Selected position | Successful return |
| --- | --- | --- |
| `table.remove(target)` | `L`. | Exactly one value: the value read at the selected position, possibly `nil`. |
| `table.remove(target, nil)` | `L`. | The same as above. |
| `table.remove(target, position)` | `position // 1`. | The same as above. |

Removal first takes the length snapshot `L`. It then selects `p` using the table above. For a finite selected position, it performs these operations in order:

1. Read and retain `target[p]` as the result.
2. For `i = p, p + 1, …, L - 1`, in that ascending order, assign `target[i] = target[i + 1]`.
3. Always assign `nil` to `target[L]`.
4. Return the retained result.

Use a finite numeric explicit position. A nonnil nonnumeric position produces NaN without an upfront argument error. The shift then repeatedly reads and writes the NaN key; its comparison does not terminate the loop. It does not reach the final tail clear or returned result by normal loop termination. A reached fault or other interruption remains possible. Positions are neither checked nor clamped. Zero and negative positions refer to actual keys, not positions relative to the end. They can therefore cause shifting through zero or negative keys. A position above `L` skips the shifting but **still clears key `L`**:

```lua
local values = {10, 20, 30}
local removed = table.remove(values, 99)
-- removed is nil.
-- values[1] is 10; values[2] is 20; key 3 is absent.
```

The default position is also used when `L` is zero. For a table whose length snapshot is zero and whose key `0` contains `7`, `table.remove(target)` returns `7` and deletes key `0`.

Throughout these functions, element reads are ordinary table reads, including a table-valued `__index` where applicable. Assignments write directly to the target and do not call `__newindex`. Copying a `nil` deletes the destination mapping. Removal leaves a field named `n` unchanged. If a later operation fails, earlier assignments remain in effect; these functions do not undo them.

## `table.sort`

| Call | Ordering | Successful return |
| --- | --- | --- |
| `table.sort(target)` | Ordinary `<`. | One `nil` value. |
| `table.sort(target, nil)` | Ordinary `<`. | One `nil` value. |
| `table.sort(target, compare)` | `compare(left, right)` is truthy when `left` belongs before `right`. | One `nil` value. |

Sorting modifies `target` in place. It takes the length snapshot `L` first and operates on keys `1` through `L`; it does not make or return a sorted copy. If `L < 2`, it immediately returns one `nil` value without performing a comparison or checking whether `compare` can be called. Thus `table.sort({1}, false)` returns normally, whereas a nontrivial sort with `false` as its comparator attempts to call `false` and raises the ordinary non-function call error.

The sort begins by scanning from index `2` through `L`. At each index it asks whether the current value belongs before its predecessor. Falsey answers continue the scan. The first truthy answer starts a quicksort of the **entire** range `1` through `L`, not just the remaining suffix. If the scan reaches the end, the sort itself makes no assignments; with a valid custom comparator this ordered-input path makes exactly `L - 1` comparator calls.

For each partition from `first` through `last`, the quicksort retains `target[(first + last) // 2]` as its pivot and scans inward. Each swap saves the left value, writes the right value into the left key, then writes the saved value into the right key; the two writes are sequential, not atomic. Do not depend on the order of equal elements: this sort has no stability guarantee. Apart from the ordered-input scan described above, neither a particular comparison schedule nor a particular callback count is promised.

### Choosing an ordering

With no comparator, ordinary `<` compares numbers numerically with numbers and strings lexically with strings. For other combinations it yields `false`; it does not raise a comparison error or convert strings to numbers. Do not use the default ordering to establish an order between numbers and strings, or between other categories of values.

A custom comparator receives two values. Only its first returned value is used. `nil` and `false` mean “does not belong before”; every other value, including `0` and `""`, means “belongs before.” Return a Boolean comparison, not a three-way numeric difference.

```lua
local values = {3, 1, 2}
table.sort(values, function(left, right)
    return left > right
end)
-- values now contains 3, 2, 1 at keys 1, 2, 3.
```

For records, compare the desired field:

```lua
local jobs = {{priority = 3}, {priority = 1}, {priority = 2}}
table.sort(jobs, function(left, right)
    return left.priority < right.priority
end)
-- The priorities at keys 1, 2, 3 are now 1, 2, 3.
```

<section class="keep-together">

The comparator must supply a consistent strict ordering: `compare(x, x)` must be falsey; if `compare(a, b)` is truthy, `compare(b, a)` must be falsey; and the ordering must be transitive. The sort does not validate these rules. An inconsistent comparator can make its scans pass outside the selected prefix, read `nil`, or fail to terminate.

</section>

Do not change the target's keys or ordering from the comparator. The sort does not refresh its length snapshot or retained pivot around callbacks. A comparator error is an ordinary error that can be caught with `pcall`; it does not undo swaps already made. A failed sort can therefore leave the input partly reordered. For the specific input `{3, 1, 2}`, a comparator that returns `left < right` on its first four calls and raises a particular table value on its fifth call leaves the values at keys `1`, `2`, `3` as `1`, `3`, `2`; `pcall` returns `false` followed by that same error table. This is one bounded example, not a promised partial order for other failures.

### Work performed

These functions run ordinary instruction sequences; they are not fixed-cost services. Appending performs one assignment. When the unit-step loop completes normally, positional insertion performs `L - p + 1` shift assignments when `p <= L`, otherwise none, followed by the final assignment at `p`. When its unit-step loop completes normally, removal performs `L - p` shift assignments when `p <= L - 1`, otherwise none, followed by its one unconditional clear at `L`.

For a consistent strict ordering, the sort's initial scan performs at most `L - 1` comparisons. Further work depends on the input and comparator. Do not budget a fixed cycle count or assume a general callback-count bound from these examples.

## Errors and resource limits

There is no separate table-library bounds, arity or invalid-sort error. The
operation that is actually reached determines a shared error or effect; there
is no uniform argument-validation pass before the procedure begins.

| Reached operation | Error text |
| --- | --- |
| Length of an unsupported value | `Attempted to get length of an unsupported value.` |
| Indexing a value with no indexing support | `Attempted to index field on a non-table value.` |
| Assignment to a non-Table | `Attempted to assign to a non-table value.` |
| Calling a nonfunction | `Attempted to call a non-function value.` |
| Exhausting the Table-valued index chain | `Metatable __index loop detected.` |
| Exhausting available heap storage | `Out of memory.` |

This table identifies shared error text, not an assertion that every wrong
argument immediately raises one of these errors. In particular, mixed-category
less-than and nonnumber arithmetic follow the CPU value rules described above.
A comparator can raise an arbitrary original value, not just a String.
**Protected calls and coroutines** defines the protected-call boundary;
**System control and timing** defines hardware fault publication. Do not treat
error interception as restoration of a modified Table.

There is no table-library maximum endpoint, output size or comparator count
that makes an arbitrary call safe. Unpacking expands a recursive result chain;
concatenation creates intermediate Strings; packing repeatedly forwards its
argument tuple and selects a suffix. The number of numeric stores in a pack is
not a constant total-work or allocation budget. Large, nonfinite or inconsistent
inputs do not acquire a termination or resource guarantee from these APIs.

## Complete program: sequences and counted tuples

This program uses the installed `table` global together with the already
introduced `select`, `print`, `pcall` and `error` services. It first preserves a
four-position tuple with two nil values, then edits and sorts an ordinary
numeric sequence. Finally it catches a comparator error and observes the
sequence left by the interrupted sort.

The complete source consists of the result-storage module below and the three
entry listings in order. The result module is named `results`; the entry
imports its exported storage address. **Memory and program storage** explains
these declarations and typed views. The `f64` fields retain actual numeric
results. Word fields retain counts or the stated comparison observations;
they are not encodings of general language values.

### Result storage

```lua
module<const>

struct bios_table_manual_result
	completed: word
	packed_count: word
	tuple_first: f64
	tuple_third: f64
	tuple_holes: word
	tuple_count: word
	packed_text_match: word
	insert_count: word
	removed: f64
	sequence_length: word
	sort_count: word
	ascending: f64[4]
	default_unpack_count: word
	negative_text_match: word
	zero_text_match: word
	empty_concat_length: word
	empty_unpack_count: word
	descending: f64[4]
	last_removed: f64
	remaining_length: word
	comparison_count: word
	failure_identity: word
	partial: f64[3]
end

bss result: bios_table_manual_result

return { result = result }
```

### Entry, part 1: preserve the tuple count

`table.pack` gives this tuple an explicit `n` of four. Use that field as the
end index when unpacking: the interior and trailing nil positions must not be
inferred from Table length. The two fixed numeric results go directly into
typed storage; local variables receive the nil positions. `select('#', ...)`
observes the actual expanded result count.

The explicit concatenation range also contains all four positions. Nil
contributes an empty field, but the separators remain, producing `10||30|`.
The program does not substitute a length derived from populated mappings for
`packed.n`.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_table_manual_result = state.result

-- The explicit count preserves nil positions, including the trailing nil.
local packed<const> = table.pack(10, nil, 30, nil)
result.packed_count = packed.n
local gap, tail
result.tuple_first, gap, result.tuple_third, tail =
	table.unpack(packed, 1, packed.n)
result.tuple_holes = gap == nil and tail == nil and 1 or 0
result.tuple_count = select('#', table.unpack(packed, 1, packed.n))
print('Packed tuple', result.tuple_first, gap, result.tuple_third, tail)
print('Tuple counts', result.packed_count, result.tuple_count)
local packed_text<const> = table.concat(packed, '|', 1, packed.n)
result.packed_text_match = packed_text == '10||30|' and 1 or 0
print('Packed concat', packed_text)

```

### Entry, part 2: edit and read an ordinary sequence

Starting with `9, 3, 7`, positional insertion produces `9, 5.5, 3, 7`.
Removing position three returns `3`; the two-argument insert appends `8`.
The default ascending sort then produces `5.5, 7, 8, 9`. The program observes
one result from each counted insert and sort call: the ordinary source
return is one nil, not a zero-result tuple.

These are real default-length operations: append, sort, unpack and
concatenation use the Table's maintained length. Default unpack returns the
four sorted Numbers. Negative endpoints `-3, -1` select positions two through
four here; zero endpoints select the default first and last positions.
An explicit reversed range produces an empty String from `concat`, but no
results from `unpack`. An empty String and an empty result tuple are different
observations.

```lua
-- Ordinary sequence operations use the Table's maintained length.
local sequence<const> = { 9, 3, 7 }
result.insert_count = select('#', table.insert(sequence, 2, 5.5))
result.removed = table.remove(sequence, 3)
table.insert(sequence, 8)
result.sequence_length = #sequence
result.sort_count = select('#', table.sort(sequence))
result.ascending[0], result.ascending[1],
	result.ascending[2], result.ascending[3] = table.unpack(sequence)
result.default_unpack_count = select('#', table.unpack(sequence))
print('Mutation', result.insert_count, result.removed, result.sequence_length)
print('Ascending', result.sort_count, table.concat(sequence, ','))
print('Default unpack', table.unpack(sequence))
print('Default unpack count', result.default_unpack_count)

local negative_text<const> = table.concat(sequence, ':', -3, -1)
local zero_text<const> = table.concat(sequence, ':', 0, 0)
local empty_text<const> = table.concat(sequence, ':', 3, 2)
result.negative_text_match = negative_text == '7:8:9' and 1 or 0
result.zero_text_match = zero_text == '5.5:7:8:9' and 1 or 0
result.empty_concat_length = #empty_text
result.empty_unpack_count = select('#', table.unpack(sequence, 3, 2))
print('Negative range', negative_text)
print('Zero range', zero_text)
print('Empty ranges', empty_text, result.empty_unpack_count)

```

The observed length four belongs to this sequence and these operations.
It is not a count of all Table mappings or a replacement for an explicit tuple
count when nil positions matter.

### Entry, part 3: a custom order and an interrupted sort

The first comparator orders the same Numbers descending. Default removal then
returns the last Number, `5.5`, leaving length three in this run.

The second comparator deliberately raises the same Table object on its fifth
call. The protected call returns false and that original object. An earlier
swap remains visible: `3, 1, 2` has become `1, 3, 2`. Protection does not restore
the original order. This exact comparison count and partial arrangement are
observations of the shown call, not a promised comparator-visit schedule.
The program records completion and remains in `halt_until_irq`.

```lua
-- A comparator orders these same Numbers in descending order.
table.sort(sequence, function(left, right) return left > right end)
result.descending[0], result.descending[1],
	result.descending[2], result.descending[3] = table.unpack(sequence)
print('Descending', table.concat(sequence, ','))
result.last_removed = table.remove(sequence)
result.remaining_length = #sequence
print('Removed last', result.last_removed, result.remaining_length)

-- Protection catches the error value; it does not undo earlier swaps.
local partial<const> = { 3, 1, 2 }
local failure<const> = { code = 72 }
local ok<const>, caught<const> = pcall(table.sort, partial,
	function(left, right)
		result.comparison_count = result.comparison_count + 1
		if result.comparison_count < 5 then
			return left < right
		end
		error(failure)
	end)
result.failure_identity = not ok and caught == failure and 1 or 0
result.partial[0], result.partial[1], result.partial[2] = table.unpack(partial)
print('Comparator failure', ok, caught == failure, result.comparison_count)
print('Partial sequence', table.concat(partial, ','))
result.completed = 1
while true do
	halt_until_irq
end
```

### Retained observations

<section class="keep-together">

The following table names every retained field. A comparison word of one
means the condition written in the program was true. Array values below are
listed in typed-storage index order, starting at index zero.

| Field | Retained value |
| --- | --- |
| `completed` | `1` |
| `packed_count`, `tuple_count` | `4`, `4` |
| `tuple_first`, `tuple_third` | `10`, `30` |
| `tuple_holes` | `1`: both received positions are nil |
| `packed_text_match` | `1`: `10\|\|30\|` |
| `insert_count`, `sort_count` | `1`, `1` |
| `removed`, `sequence_length` | `3`, `4` |
| `ascending` | `5.5`, `7`, `8`, `9` |
| `default_unpack_count` | `4` |
| `negative_text_match` | `1`: `7:8:9` |
| `zero_text_match` | `1`: `5.5:7:8:9` |
| `empty_concat_length`, `empty_unpack_count` | `0`, `0` |
| `descending` | `9`, `8`, `7`, `5.5` |
| `last_removed`, `remaining_length` | `5.5`, `3` |
| `comparison_count`, `failure_identity` | `5`, `1` |
| `partial` | `1`, `3`, `2` |

</section>

### Diagnostic output

After the startup messages, the program emits these fourteen lines.
Separators between printed arguments below are literal tabs. In the
`Empty ranges` line, two adjacent tabs surround the empty String.

```text
Packed tuple	10	nil	30	nil
Tuple counts	4	4
Packed concat	10||30|
Mutation	1	3	4
Ascending	1	5.5,7,8,9
Default unpack	5.5	7	8	9
Default unpack count	4
Negative range	7:8:9
Zero range	5.5:7:8:9
Empty ranges		0
Descending	9,8,7,5.5
Removed last	5.5	3
Comparator failure	false	true	5
Partial sequence	1,3,2
```
