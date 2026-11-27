# BIOS table library {#sec-bios-table}

The `table` functions copy, pack, edit, join and sort tables. Sequence
positions start at 1. For byte buffers and device data, use
[typed arrays](blua-programs.md#sec-blua-programs-typed-storage-layouts-and-address-views)
instead: tables live in [BLua storage](blua-system.md#sec-blua-system-blua-storage)
and have no bus address.

| Function | Purpose | Results |
| --- | --- | --- |
| `table.copy(source)` | Copy a table | New table |
| `table.pack(...)` | Pack values with their count | New table |
| `table.insert(t, value)` | Append | None |
| `table.insert(t, pos, value)` | Insert | None |
| `table.remove(t [, pos])` | Remove | The removed value |
| `table.concat(t [, sep [, i [, j]]])` | Join as text | String |
| `table.unpack(t [, i [, j]])` | Return the elements | t[i] … t[j] |
| `table.sort(t [, compare])` | Sort | None |

`table.pack` stores the values themselves, not copies: a packed table still
refers to the same objects.

## Creating a table {#sec-bios-table-construction}

In BLua, use a table constructor such as `{}` or `{12, 34, name = "item"}`.

Machine code creates a table by calling the table constructor of the BIOS
([System function 3](program-images.md#sec-blua-programs-locating-bios-call-targets))
with two Integers from 0 to 32767: the number of array slots and the number of
hash slots. For example, with the function in R(4), 8 in R(5) and 3 in R(6),
`CALL R(4), 3, 2` returns in R(4) an empty table with 8 array slots and 4 hash
slots (the hash size is rounded up to a power of two). Other arguments raise
`INVALID_ARGUMENT`; without memory the call raises `OUT_OF_MEMORY`.

## General rules {#sec-bios-table-tables-lengths-and-visible-effects}

**L** is the length `#t` at the start of the call (see
[table length](cpu.md#sec-cpu-table-length)). Positions 0 and below are
ordinary keys; only `concat` and `unpack` count negative positions from the
end.

The functions read elements as ordinary indexing (so `__index` applies) and
write them directly (without `__newindex`). Writing nil removes an entry.
Changes are made one by one; after an error, the changes already made remain.

These functions are BLua code: their time depends on the number of elements
and on the comparison function.

## table.copy {#sec-bios-table-copy}

```text
table.copy(source) -> copy
```

Returns a new table without a metatable, holding the same keys and values as
the source's own entries. The values themselves are not copied. Entries
inherited through `__index` are not copied. The copy has the same capacity as
the source. A value other than a table raises `INVALID_ARGUMENT`.

```lua
local defaults = { hp = 20, position = { x = 4, y = 7 } }
local instance = table.copy(defaults)
instance.hp = 10
-- defaults.hp is still 20; both refer to the same position table.
```

## Packing and ranges {#sec-bios-table-packing-and-reading-table-ranges}

### table.pack {#sec-bios-table-tablepack}

```text
table.pack(...) -> packed
```

Returns a table with the arguments at 1, 2, … and their number in field `n`,
nil arguments included.

```lua
local packed = table.pack(10, nil, 30, nil)
-- packed.n is 4; packed[2] and packed[4] are nil.
local empty = table.pack()
-- empty.n is 0.
```

`n` is an ordinary field; the other functions do not use it. To unpack all
values, pass `packed.n` as the end.

### Ranges {#sec-bios-table-selecting-a-range}

`unpack` and `concat` take a range i to j, by default 1 to L. Each bound is
rounded down (`// 1`) and then:

| Value | Start | End |
|---|---:|---:|
| Positive | The value | The value |
| Negative | L + value + 1 | L + value + 1 |
| 0 or NaN | 1 | L |

With L = 4: (−3, −1) gives 2 to 4; (0, 0) gives 1 to 4; (1.9, 2.9) gives 1 to 2.

The bounds are not limited to 1…L. If the end is below the start, the range is
empty. A bound that is not a number raises `INVALID_ARGUMENT`.

### table.unpack {#sec-bios-table-tableunpack}

```text
table.unpack(t [, i [, j]]) -> t[i], …, t[j]
```

Returns one result per position in the range, nil included; an empty range
returns no results.

```lua
select('#', table.unpack(packed, 1, packed.n)) -- 4
select('#', table.unpack(packed, 2, 2))        -- 1
select('#', table.unpack(packed, 3, 2))        -- 0
```

### table.concat {#sec-bios-table-tableconcat}

```text
table.concat(t [, sep [, i [, j]]]) -> text
```

Joins the elements of the range with `sep` (default "") between them. nil
gives an empty string; other values are converted as in
[concatenation](cpu.md#sec-cpu-truth-length-and-text), so any value can be
joined. An empty range gives "".

```lua
table.concat(packed, '|', 1, packed.n) -- "10||30|"
table.concat({true, {}, nil, 7}, false, 1, 4)
-- "truefalsetablefalsefalse7"
```

## table.insert {#sec-bios-table-tableinsert}

```text
table.insert(t, value)
table.insert(t, pos, value)
```

With two arguments, `value` is assigned to `t[L + 1]`; `table.insert(t, nil)`
appends nil. With three, p = pos // 1; the elements p to L are moved up by one
(from the top down) and `value` is assigned to `t[p]`. pos must be a finite
number. It is not limited: 0 and negative values are ordinary keys, and a p
greater than L leaves a gap.

```lua
local values = {10, 20}
table.insert(values, 0, 7)
-- values[0] = 7, values[1] = nil, values[2] = 10, values[3] = 20

local values = {10, 20}
table.insert(values, 5.9, 99)
-- values[1] = 10, values[2] = 20, values[5] = 99
```

## table.remove {#sec-bios-table-tableremove}

```text
table.remove(t [, pos]) -> value
```

p = pos // 1, or L if pos is missing or nil. remove returns `t[p]`, moves the
elements p + 1 to L down by one and then sets `t[L]` to nil — also when p is
greater than L:

```lua
local values = {10, 20, 30}
local removed = table.remove(values, 99)
-- removed is nil; values is {10, 20}
```

With L = 0, `table.remove(t)` returns and removes `t[0]`. pos must be a finite
number.

## table.sort {#sec-bios-table-tablesort}

```text
table.sort(t [, compare])
```

Sorts `t[1]` to `t[L]` in place, with `<` or with `compare(a, b)`, which
returns true when a must come before b. With L < 2 nothing is done (and
`compare` is not checked). The order of equal elements may change. If the
elements are already in order, the sort makes L − 1 comparisons and no
changes.

### Comparison {#sec-bios-table-choosing-an-ordering}

`<` compares numbers with numbers and strings with strings; other
combinations give false. A comparison function returns true or false (only the
first result is used); do not return a numeric difference.

```lua
local values = {3, 1, 2}
table.sort(values, function(left, right)
    return left > right
end)
-- values is {3, 2, 1}

local jobs = {{priority = 3}, {priority = 1}, {priority = 2}}
table.sort(jobs, function(left, right)
    return left.priority < right.priority
end)
-- priorities 1, 2, 3
```

The comparison must be a strict order: `compare(x, x)` false, never both
`compare(a, b)` and `compare(b, a)` true, and transitive. Otherwise the sort
can read outside the range or not end. Do not change the table inside the
comparison function.

### Time {#sec-bios-table-work-performed}

Appending writes one element. Inserting at p ≤ L writes L − p + 2 elements;
removing at p ≤ L writes L − p + 1.

## Errors {#sec-bios-table-errors-and-resource-limits}

The functions raise the errors of the operations they perform:

| Operation | Message |
| --- | --- |
| Length of an unsuitable value | `Attempted to get length of an unsupported value.` |
| Indexing an unsuitable value | `Attempted to index field on a non-table value.` |
| Assignment to a non-table | `Attempted to assign to a non-table value.` |
| Calling a non-function | `Attempted to call a non-function value.` |
| `__index` chain too long | `Metatable __index loop detected.` |
| No memory | `Out of memory.` |

A comparison function may raise any error. Changes already made remain; see
[protected calls](coroutines.md#sec-coroutines).

## Examples {#sec-bios-table-programming-examples}

### Keeping the count {#sec-bios-table-preserve-the-tuple-count}

```lua
local packed = table.pack(10, nil, 30, nil)
local first, gap, third, tail = table.unpack(packed, 1, packed.n)
local count = select('#', table.unpack(packed, 1, packed.n))
local text = table.concat(packed, '|', 1, packed.n)
-- 10, nil, 30, nil; count = 4; text = '10||30|'
```

### Editing a sequence {#sec-bios-table-edit-and-read-a-sequence}

```lua
local sequence = {9, 3, 7}
table.insert(sequence, 2, 5.5)            -- 9, 5.5, 3, 7
local removed = table.remove(sequence, 3) -- 3; 9, 5.5, 7
table.insert(sequence, 8)                 -- 9, 5.5, 7, 8
table.sort(sequence)                      -- 5.5, 7, 8, 9
local first, second, third, fourth = table.unpack(sequence)
local suffix = table.concat(sequence, ':', -3, -1) -- '7:8:9'
local all = table.concat(sequence, ':', 0, 0)      -- '5.5:7:8:9'
local empty = table.concat(sequence, ':', 3, 2)    -- ''
local count = select('#', table.unpack(sequence, 3, 2)) -- 0

table.sort(sequence, function(left, right) return left > right end)
-- 9, 8, 7, 5.5
local last = table.remove(sequence) -- 5.5; 9, 8, 7
```

### An error during sorting {#sec-bios-table-handle-an-interrupted-sort}

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
-- ok is false; caught is failure; values is {1, 3, 2}
```

The exchanges made before the error remain.
