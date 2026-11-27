# BIOS base services {#sec-bios-base}

The BIOS provides the basic functions for checking and converting values,
traversing tables, selecting arguments, accessing globals by name and printing.
They are available as globals when the program starts. `error`, `pcall` and
`xpcall` are described under [protected calls and coroutines](coroutines.md#sec-coroutines).

| Task | Function |
| --- | --- |
| Convert text to a number | `tonumber(value [, base])` |
| Convert a value to text; print | `tostring(value)`, `print(...)` |
| Traverse all entries of a table | `next(t [, key])`, `pairs(t)` |
| Traverse a sequence | `ipairs(t)` |
| Count or select arguments | `select(n, ...)` |
| Access a global by name | `getglobal(name)`, `setglobal(name, value)` |
| Access a table's own entries | `rawget`, `rawset` |
| Get or set a metatable | `getmetatable`, `setmetatable` |
| BLua storage | `collectgarbage(option)` |

Arithmetic does not convert strings: use `tonumber`. The number 0 is true in
conditions.

## Program environment {#sec-bios-base-installed-program-environment}

Before the program starts, the BIOS installs the base functions and the
libraries `table`, `string`, `coroutine`, `lua_compiler`, `load`, `os` and
`math`. These are ordinary globals, which the program may change. There is no
`_G` or `_ENV` table; use `getglobal` and `setglobal`. Environments for
[runtime compilation](bios-loader.md#sec-bios-loader-name-binding-and-retained-dependencies)
are a separate matter.

### Names {#sec-bios-base-installed-names-and-library-tables}

Base functions:

- `next`, `type`, `setmetatable`, `getmetatable`, `rawget`, `rawset`;
- `getglobal`, `setglobal`, `select`;
- `error`, `pcall`, `xpcall`, `assert`;
- `rawequal`, `tostring`, `tonumber`, `print`, `ipairs`, `pairs`, `collectgarbage`.

Libraries:

| Name | Contents |
| --- | --- |
| `table` | [Table library](bios-table.md#sec-bios-table) |
| `string` | [String library](bios-string.md#sec-bios-string); also used for string indexing |
| `coroutine` | [Coroutines](coroutines.md#sec-coroutines) |
| `math` | [Mathematics library](bios-math.md#sec-bios-math) |
| `os` | [Time and date](bios-os.md#sec-bios-os) |
| `lua_compiler` | `compile_syntax`, `syntax_factory` and `load`; see [runtime compilation](bios-loader.md#sec-bios-loader) |
| `load` | The same function as `lua_compiler.load` |

### Replacing globals {#sec-bios-base-public-bindings-and-library-references}

A global can be given a new value; references saved earlier keep the old one.
Some functions use the current value of other globals: `pairs` uses `next`,
`print` uses `select` and `tostring`, and `tonumber` uses `type` and `error`.
`assert` and the string functions keep the functions they had at
installation. String methods are found through the string table installed by
the BIOS, also if the global `string` is changed.

## collectgarbage {#sec-bios-base-collectgarbage}

```text
collectgarbage([option]) -> result
```

[BLua storage](blua-system.md#sec-blua-system-blua-storage) is reclaimed automatically; `collectgarbage` reports its use
or reclaims storage at a convenient moment, such as a loading screen.

| Option | Function | Result |
| --- | --- | --- |
| None, nil or `'collect'` | Reclaim all unused storage | 0 |
| `'count'` | Storage in use (unused storage not yet reclaimed included) | KiB |
| `'capacity'` | Total size of BLua storage | KiB |
| `'step'` | One step of reclamation | true if a cycle has been completed |

Other options raise an error.

```lua
local occupied_kib = collectgarbage('count')
local capacity_kib = collectgarbage('capacity')
local cycle_finished = collectgarbage('step')
```

The time of a step is not limited. During `collectgarbage` the devices continue,
but no interrupt handler is entered.

## Values {#sec-bios-base-value-checks-and-conversion}

Missing arguments are nil.

### assert {#sec-bios-base-assertcondition}

```text
assert(condition, ...) -> condition, ...
```

If `condition` is true (not nil or false), assert returns all its arguments
unchanged, nil included:

```lua
local condition, message, absent, code = assert(0, 'kept', nil, 7)
-- 0, 'kept', nil, 7
```

Otherwise it raises the second argument, or `'assertion failed!'` if there is
none. So `assert(false, nil)` raises nil and `assert(false)` raises
`'assertion failed!'`.

### rawequal {#sec-bios-base-rawequalleft-right}

```text
rawequal(a, b) -> boolean
```

Compares without `__eq`, as in the [EQ instruction](cpu.md#sec-cpu-comparisons-and-conditional-execution):
different kinds are unequal; numbers by value (NaN unequal, +0 = −0); strings
by contents; tables, closures and threads by identity; built-in functions by
which function they are.

### type {#sec-bios-base-typevalue}

```text
type(value) -> name
```

| Value | Result |
| --- | --- |
| nil | `'nil'` |
| false, true | `'boolean'` |
| Number | `'number'` |
| String | `'string'` |
| Thread | `'thread'` |
| Table | `'table'` |
| Closure, built-in function | `'function'` |

### tostring {#sec-bios-base-tostringvalue}

```text
tostring(value) -> string
```

Converts as `'' .. value` does; `__tostring` is not used.

| Value | Text |
| --- | --- |
| nil, false, true | `nil`, `false`, `true` |
| String | Unchanged |
| Thread | `thread` |
| Table | `table` |
| Function | `function` |
| NaN, −infinity, +infinity | `nan`, `-inf`, `inf` |
| Number | See [number to text](cpu.md#sec-cpu-default-number-to-text-conversion) |

### tonumber {#sec-bios-base-tonumbervalue-base}

```text
tonumber(value [, base]) -> number or nil
```

Without base (or with base nil): a number is returned unchanged, a string is
converted (nil if it is not a number), and other values give nil. With a base,
value must be a string.

#### Characters {#sec-bios-base-character-and-token-rules}

Spaces (code 32 and 9–13) are allowed before and after the number, not inside
it. One sign (`+` or `-`) is allowed after the leading spaces. Digits are `0`–`9`
and the letters `A`–`Z` or `a`–`z` (values 10–35), as far as they are below the
base. The whole string must be used; otherwise the result is nil.

#### Without base {#sec-bios-base-default-string-form}

| Part | Decimal | Hexadecimal |
| --- | --- | --- |
| Prefix | — | `0x` or `0X` (after the sign) |
| Digits | At least one, before or after the point | At least one |
| Fraction | `.` and digits | — |
| Exponent | `e` or `E`, sign, at least one digit | — |

Examples: `.25`, `12.` and `12.25` are numbers; `.` is not. A leading 0 does not
select octal.

#### With base {#sec-bios-base-explicit-base-string-form}

The base is an integer from 2 to 36. The string holds digits of that base only:
no point, no exponent, and no `0x` prefix (with base 16, `0x` is not a valid
digit sequence).

#### Errors {#sec-bios-base-argument-check-order-and-errors}

With a base, these are checked in order:

1. value is a string, otherwise `bad argument #1 to tonumber (string expected)`;
2. base is an integer, otherwise `bad argument #2 to tonumber (integer expected)`;
3. base is from 2 to 36, otherwise `bad argument #2 to tonumber (base out of range)`.

A base that is not a number raises `INVALID_ARGUMENT`.

#### Results {#sec-bios-base-arithmetic-and-execution-cost}

A decimal number without point or exponent that fits in 32 bits gives an
Integer; otherwise a Float, rounded to nearest. `tonumber('-2147483648')` is the
smallest Integer, `tonumber('2147483648')` a Float, and `tonumber('-0.0')` is −0.0.
Hexadecimal and base forms give an Integer of the low 32 bits:
`tonumber('0xffffffff')` and `tonumber('ffffffff', 16)` are both −1.

## Tables and metatables {#sec-bios-base-table-and-metatable-access}

| Function | Function |
| --- | --- |
| `setmetatable(t, mt)` | Sets the metatable to `mt` (nil removes it); returns t |
| `getmetatable(t)` | Returns the metatable, or nil |
| `rawget(t, key)` | Returns t's own entry, without `__index` |
| `rawset(t, key, value)` | Sets t's own entry, without `__newindex`; nil removes it; returns t |

The first argument must be a table, and mt a table or nil; otherwise
`INVALID_ARGUMENT` (10). In BLua, give all arguments; pass nil explicitly to
remove. `rawget` with a nil or NaN key returns nil; `rawset` with such a key
raises `INDEX_NIL` (4) or `INDEX_NAN` (12). `rawset` enlarges the table if
needed, or raises `OUT_OF_MEMORY`. See the [CPU](cpu.md#sec-cpu-metatables-and-indexed-reads)
for `__index` and `__newindex`.

## Traversal, arguments, globals and printing {#sec-bios-base-traversal-argument-selection-globals-and-output}

### next {#sec-bios-base-nexttable-key}

```text
next(t [, key]) -> key, value
```

Returns the entry of t that follows key (the first entry if key is nil), or
one nil at the end. The order is not defined. A value other than a table raises
`Attempted to iterate a non-table value.`; an unknown key raises
`INVALID_NEXT_KEY` (11), `invalid key to 'next'`.

During a traversal, existing entries may be changed or removed; a removed key
can still be used to continue. **Do not add new entries during a traversal.**
`next` visits the table's own entries only. The end is marked by a nil key; a
false value is an ordinary value.

### pairs {#sec-bios-base-pairstarget}

```text
pairs(t) -> next, t, nil
```

For use in `for k, v in pairs(t)`. `pairs` returns the current global `next`;
`__pairs` is not used. The loop ends when the first result is nil.

### ipairs {#sec-bios-base-ipairstarget}

```text
ipairs(t) -> iterator, t, 0
```

The iterator returns (1, t[1]), (2, t[2]), … and stops at the first nil value; a
false value does not stop it. It reads with ordinary indexing, so `__index`
applies; `__ipairs` is not used. It does not use the length of the table.

### select {#sec-bios-base-selectselector}

```text
select('#', ...) -> count
select(n, ...) -> ...
```

`select('#', ...)` returns the number of arguments, nil included. `select(n, ...)`
returns the arguments from position n on; a negative n counts from the end:

| n | Results |
| --- | --- |
| 1 to count | Argument n and the following |
| −1 | The last argument |
| 0, or below −count | All arguments |
| Above count | None |

n is rounded towards 0 and taken as a 32-bit number (NaN and infinity become 0).
Other selectors raise `Invalid argument.`

### getglobal and setglobal {#sec-bios-base-getglobalname-and-setglobalname-value}

```text
getglobal(name) -> value
setglobal(name, value)
```

`getglobal` returns the current value of the ordinary global `name`, or nil.
`setglobal` sets it (and creates it if needed). name must be a string,
otherwise `Invalid argument.` `setglobal` returns no results.
Local variables and [system globals](cpu.md#sec-cpu-two-global-namespaces) of the
same name are separate.

### print {#sec-bios-base-print}

```text
print(...)
```

Prints the arguments converted with `tostring`, separated by tabs, and ends the
line. nil arguments are printed as `nil`. `print()` prints an empty line.
`print` returns one nil.

#### Console {#sec-system-bios-console-integration}

The console sends each character to PRINT_CHAR of the
[diagnostic output](system.md#sec-system-diagnostic-text-output) and keeps it in
its history: characters up to 255 unchanged, others as `?`. At the end of the
line it adds a line feed to the history and writes 1 to PRINT_FLUSH. The
history holds 8192 characters; when it is full, the oldest are replaced. The
console draws its history separately; `print` does not draw. Writing the SYSTEM
ports directly does not add to the history. See the
[example](bios-monitor.md#sec-system-send-a-diagnostic-line).

### Errors and time {#sec-bios-base-faults-and-incremental-cycle-charges}

`pairs` and `ipairs` do not check their argument; an unsuitable value causes an
error when the loop starts. `next`, `select`, `getglobal` and `setglobal` take
1 cycle plus the call; `type` 1 cycle. The other functions are BLua code.

## Examples {#sec-bios-base-programming-examples}

### assert and tonumber {#sec-bios-base-assertions-and-numeric-text}

```lua
local first, label, gap, last = assert(0, 'kept', nil, 7)
-- 0, 'kept', nil, 7
local count = select('#', assert(0, 'kept', nil, 7)) -- 4
local ok, value = pcall(assert, false, nil)          -- false, nil
local default_ok, message = pcall(assert, false)
-- false, 'assertion failed!'

local unchanged = tonumber(12.5)      -- 12.5
local decimal = tonumber(' -12.5e1 ') -- -125
local fraction = tonumber('.25')      -- 0.25
local hex = tonumber('0x10')          -- 16
local binary = tonumber('-101', 2)    -- -5
local base36 = tonumber('z', 36)      -- 35
local rejected = tonumber('12x')      -- nil
local ok, message = pcall(tonumber, '10', 37)
-- false, 'bad argument #2 to tonumber (base out of range)'
```

### Identity and traversal {#sec-bios-base-identity-and-traversal}

```lua
local inventory = {apples = 11, pears = 22, plums = 33}
local same = inventory
local other = {apples = 11, pears = 22, plums = 33}
local shared = rawequal(inventory, same)    -- true
local distinct = rawequal(inventory, other) -- false
local category = type(inventory)            -- 'table'
local label = tostring(inventory)           -- 'table'
local total = 0
for name, quantity in pairs(inventory) do
    total = total + quantity
end
-- total = 66

local sequence = {10, 20, nil, 90}
local total = 0
for index, quantity in ipairs(sequence) do
    total = total + quantity
end
-- total = 30: ipairs stops at sequence[3]
local singleton = {[4] = 41}
local key, value = next(singleton)       -- 4, 41
local finished = next(singleton, key)    -- nil
local result_count = select('#', next(singleton, key)) -- 1
```

### Arguments and globals {#sec-bios-base-tuples-and-globals}

```lua
local count = select('#', 'skip', nil, 9)                   -- 3
local first, last = select(2, 'skip', nil, 9)               -- nil, 9
local suffix_count = select('#', select(2, 'skip', nil, 9)) -- 2
local empty_count = select('#', select(4, 'skip', nil, 9))  -- 0

setglobal('score_counter', 11)
local before = score_counter -- 11
local ok, message = pcall(function()
    score_counter = 22
    error('counter changed')
end)
local after = getglobal('score_counter') -- 22: the error does not undo it
setglobal('score_counter', nil)
```

### print {#sec-bios-base-console-output}

```lua
print('Score', nil, 7)
```

prints `Score`, `nil` and `7` separated by tabs. `select('#', print())` prints an
empty line and returns 1.
