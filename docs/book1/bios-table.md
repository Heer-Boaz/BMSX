# BIOS table library

Use the BIOS `table` functions to keep argument tuples, edit sequences,
join values into text and sort a numeric-keyed range. The six functions operate
on ordinary Tables. Their sequence positions begin at key 1.

[Typed arrays](blua-programs.md#typed-storage-layouts-and-address-views) provide
the separate byte-addressed representation used for memory buffers and device
transfers. Choose that representation when fixed element widths, contiguous
bytes or a device address are required.

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
empty `unpack` interval. [BIOS base services](bios-base.md) explains `select` and result
adjustment. [Protected calls and coroutines](coroutines.md) explains interception of an
error value, including nil, without undoing earlier writes.

`table.pack` creates a Table containing the supplied values, not deep copies
of them. A packed Table, closure or Thread remains the same referenced value.
Tables and their retained values use the shared
[language allocation budget](cpu.md#language-allocation-and-lifetime);
they do not reserve a mapped byte buffer suitable for a device transfer.

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

Pass a Table target. Length and element access follow ordinary language
rules; any failure is reported when the corresponding operation is reached.
For example, a String has a codepoint length and uses the installed
String-index Table for reads; assigning to it raises the shared assignment
error. Use String operations when character access is intended.

Insert, remove and sort write the caller's Table directly, in the stated
order. There is no deferred commit or restoration on error. Pack creates a new
Table; concat and unpack do not themselves assign into the target. A callback
or a deliberately replaced public dependency can still have its own effects.
The library's public fields and the `select`/`tostring` globals it uses are
ordinary mutable bindings, not permanently reserved operations.

The functions execute ordinary instructions. Loops, tuple forwarding,
conversions, temporary Strings and comparison callbacks contribute work; a
function call is not a single constant-cycle hardware operation. The [CPU reference](cpu.md) supplies instruction charges.

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

<div class="keep-together">

### `table.concat`

```text
table.concat(target [, separator [, start [, end]]]) -> text
```

`table.concat` returns exactly one String, joining the selected positions in ascending order without changing the target. Each position is read by ordinary indexing. A `nil` value contributes an empty String; every other value is converted with the current global `tostring`. Separators remain between adjacent positions even when one or both positions read as `nil`.

</div>

An omitted or explicitly `nil` separator is the empty String. Any other separator is converted with `tostring`, so the installed `tostring` accepts values other than Strings here as well. This conversion happens before the selected values are read, even for a single-position interval where no separator is inserted. An empty interval instead returns an empty String before converting the separator or reading any positions.

```lua
table.concat(packed, '|', 1, packed.n) -- "10||30|"
table.concat({true, {}, nil, 7}, false, 1, 4)
-- "truefalsetablefalsefalse7" with the installed tostring.
```

These conversions use the live global `tostring`, not a permanently captured formatter. Replacing it can change both separator and value conversion.

Concatenation divides the selected interval at `(first + last) // 2`, joins
the two halves and inserts the separator between them. It creates intermediate
Strings as well as the result. Keep explicit endpoints in an integer range
where adding and bisecting the bounds remains exact; extreme Number bounds
can prevent the recursive interval from shrinking.

## `table.insert`

| Call | Effect | Successful return |
| --- | --- | --- |
| `table.insert(target, value)` | Assigns `value` to `target[#target + 1]`. | One `nil` value. |
| `table.insert(target, position, value, ...)` | Inserts at `position // 1`, shifting the selected keys upward as described below. Arguments after `value` are ignored. | One `nil` value. |

Exactly one argument after `target` selects the append form. A lone explicit `nil` therefore means “append `nil`,” not “position omitted.” Every other trailing argument count selects the positional form. The signatures above require at least one argument after `target`. An indirect call such as `pcall(table.insert, target)` nevertheless reaches the positional form with no trailing arguments; both selected arguments are then `nil`, so the position arithmetic produces NaN. With a separate value, an explicit `nil` position is still passed to `// 1`.

Use a finite numeric position. This arithmetic does not parse numeric Strings, and a nonnumeric position produces NaN rather than an upfront library argument error. With a NaN position, the descending shift loop has no comparison-driven exit: it can make earlier shift writes without reaching the final insertion. A reached fault or other interruption is separate from normal completion.

For a positional insertion with a finite numeric position:

1. Compute `p = position // 1`, then take the length snapshot `L`.
2. For `i = L, L - 1, …, p`, in that descending order, assign `target[i + 1] = target[i]`.
3. Assign `target[p] = value`.

The position is not checked or clamped. Zero and negative positions name those actual keys; they do not count backward from the end. If `p > L`, no keys are shifted and the only assignment is at `p`. A fractional position is rounded downward by `// 1`, so `5.9` selects key `5`.

<div class="keep-together">

For example, starting with the plain table `{10, 20}` and no key `0`:

```lua
local values = {10, 20}
table.insert(values, 0, 7)
-- values[0] is 7; values[1] is nil;
-- values[2] is 10; values[3] is 20.
```

</div>

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

Keep the target's entries and ordering unchanged inside the comparator.
The sort retains its initial length and each current pivot across callback
calls. A comparator error can be received through `pcall`, but swaps already
performed remain visible. The [interrupted-sort example](#handle-an-interrupted-sort)
shows how to distinguish that failure from successful completion.

### Work performed

These functions run ordinary instruction sequences; they are not fixed-cost services. Appending performs one assignment. When the unit-step loop completes normally, positional insertion performs `L - p + 1` shift assignments when `p <= L`, otherwise none, followed by the final assignment at `p`. When its unit-step loop completes normally, removal performs `L - p` shift assignments when `p <= L - 1`, otherwise none, followed by its one unconditional clear at `L`.

For a consistent strict ordering, the sort's initial scan performs at most `L - 1` comparisons. Further work depends on the input and comparator. Do not budget a fixed cycle count or assume a general callback-count bound from these examples.

## Errors and resource limits

Table functions report the errors of the operations they execute. Check
sequence positions and comparator behavior at the application boundary;
error handling receives a failure but leaves earlier Table changes visible.

| Reached operation | Error text |
| --- | --- |
| Length of an unsupported value | `Attempted to get length of an unsupported value.` |
| Indexing a value with no indexing support | `Attempted to index field on a non-table value.` |
| Assignment to a non-Table | `Attempted to assign to a non-table value.` |
| Calling a nonfunction | `Attempted to call a non-function value.` |
| Exhausting the Table-valued index chain | `Metatable __index loop detected.` |
| Exhausting available heap storage | `Out of memory.` |

These errors occur when the corresponding operation is reached.
Mixed-category ordering and non-Number arithmetic follow the CPU rules given
above. A comparator can also raise any language value of its own.
[Protected calls and coroutines](coroutines.md) defines the protected-call boundary;
[System control and timing](system.md) defines hardware fault publication. Do not treat
error interception as restoration of a modified Table.

Choose finite, usable endpoints and a consistent comparator. `unpack`
expands a recursive result chain, `concat` creates intermediate Strings, and
`pack` forwards its argument tuple while selecting each value. Budget for
those language objects and calls as well as for the final Table or String.

## Programming examples

### Preserve the tuple count

Use the `n` field created by `table.pack` as the explicit end when unpacking a
tuple that may contain nil. Table length is not a substitute for this count.

```lua
local packed = table.pack(10, nil, 30, nil)
local first, gap, third, tail = table.unpack(packed, 1, packed.n)
local count = select('#', table.unpack(packed, 1, packed.n))
local text = table.concat(packed, '|', 1, packed.n)
-- first = 10, gap = nil, third = 30, tail = nil.
-- packed.n and count are 4; text is '10||30|'.
```

### Edit and read a sequence

The following sequence has consecutive numeric keys starting at one. Append,
sort and the omitted range endpoints use its maintained length.

```lua
local sequence = {9, 3, 7}
table.insert(sequence, 2, 5.5)       -- 9, 5.5, 3, 7
local removed = table.remove(sequence, 3) -- 3; sequence is 9, 5.5, 7
table.insert(sequence, 8)           -- 9, 5.5, 7, 8
table.sort(sequence)               -- 5.5, 7, 8, 9
local first, second, third, fourth = table.unpack(sequence)
local suffix = table.concat(sequence, ':', -3, -1) -- '7:8:9'
local all = table.concat(sequence, ':', 0, 0)      -- '5.5:7:8:9'
local empty = table.concat(sequence, ':', 3, 2)    -- ''
local count = select('#', table.unpack(sequence, 3, 2)) -- 0
```

The observed length four belongs to this sequence. It does not define the
length of a Table with holes or count a packed tuple's nil positions. A reversed
range gives an empty String from concat but zero results from unpack.

Continue with a descending comparison and remove the final value:

```lua
table.sort(sequence, function(left, right) return left > right end)
-- sequence is now 9, 8, 7, 5.5.
local last = table.remove(sequence) -- 5.5; sequence is now 9, 8, 7.
```

### Handle an interrupted sort

An error does not undo earlier swaps. This example preserves the error object's
identity and shows the partial arrangement for one input and error point. Other
inputs or error points need not produce the same arrangement or callback count.

```lua
local values = {3, 1, 2}
local failure = {code = 72}
local comparisons = 0
local ok, caught = pcall(table.sort, values, function(left, right)
    comparisons = comparisons + 1
    if comparisons == 5 then
        error(failure)
    end
    return left < right
end)
-- ok is false; caught is the same Table as failure.
-- values now has 1, 3, 2 at keys 1, 2, 3.
```
