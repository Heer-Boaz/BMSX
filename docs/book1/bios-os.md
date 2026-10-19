# BIOS time and calendar services

The installed `os` Table supplies four functions: sample time in seconds,
convert a civil date to a timestamp, decompose or format a timestamp, and
subtract whole-second values. The `os` Table is installed before cartridge entry. It contains no filesystem
or process interface.

Use [System control and timing](system.md) for the underlying time word and
machine timing, [CPU values and numeric instructions](cpu.md#values-and-numeric-instructions)
for Number arithmetic, and [Memory and program storage](memory.md) for typed
storage and startup. [BIOS Math](bios-math.md) defines `math.modf`;
[BIOS String operations](bios-string.md) defines String slicing and codepoints.
[Protected calls and coroutines](coroutines.md) defines error interception.
The sampled counter and the civil timestamp convention are distinct: a
sampled values measure system time rather than a wall-clock or RTC reading.

| Call | Returned value | Operation |
| --- | --- | --- |
| `os.clock()` | One Number, seconds | Sample the millisecond word and divide by 1000. |
| `os.time(date_table)` | One Number, whole seconds | With nil, sample time; otherwise normalize the supplied civil fields in place and return their timestamp. |
| `os.date(format, timestamp)` | One String or new Table | Format or decompose the selected timestamp. |
| `os.difftime(t2, t1)` | One Number, seconds | Check each argument against its integer component, then subtract. |

<a id="complete-program-time-and-calendar-operations"></a>

## Example: time and calendar operations

Use an explicit timestamp for a stored calendar date. `os.time` normalizes the
caller-owned Table, while `os.date('*t', ...)` creates a separate Table:

```lua
local date = { year = 2024, month = 2, day = 28, hour = 25, min = 2, sec = 3 }
local timestamp = os.time(date)             -- 1709168523
-- date is now 2024-02-29 at 01:02:03; wday = 5, yday = 60, isdst = false.
local fields = os.date('*t', timestamp)
local label = os.date('%F %T', timestamp)   -- '2024-02-29 01:02:03'
local elapsed = os.difftime(timestamp, timestamp - 90) -- 90 seconds
```

Calendar-year and ISO-week-year fields can differ at a year boundary:

| Call | Result |
| --- | --- |
| `os.date('%F %G-W%V-%u', 1609459200)` | `'2021-01-01 2020-W53-5'` |
| `os.date('%F %G-W%V-%u', 1546214400)` | `'2018-12-31 2019-W01-1'` |
| `os.date('%c', 0)` | `'Thu Jan 01 00:00:00 1970'` |
| `os.date('%F %T', -1)` | `'1969-12-31 23:59:59'` |
| `os.date('offset %z zone %Z %%', 0)` | `'offset +0000 zone BMSX %'` |

## `os.clock()` — sampled time in seconds

`os.clock()` returns one Number: the current sampled millisecond word divided by 1000. Use it when a seconds value with millisecond granularity is more useful than the whole-second result of `os.time()`.

The sampled word contains whole milliseconds modulo 2³². Consequently, `os.clock()` ranges from 0 through 4294967.295 seconds and returns to zero when that word wraps. The division does not extend the counter's range, and decimal millisecond fractions need not have exact Number representations. This is not a CPU-exclusive accounting clock.

For example, two readings can be subtracted to measure a span within the same uninterrupted counter range:

```lua
local before = os.clock()
-- Perform the work being measured.
local after = os.clock()
local elapsed = after - before
```

The subtraction does not compensate for a wrap between the readings. Neither `os.clock()` nor `os.difftime()` supplies wrap compensation.

Each call samples the word anew. This function performs one time-word read and a division; it does not construct a civil-date Table or maintain a separate accumulated clock.

## `os.time([date_table])` — whole seconds or civil conversion

`os.time()` and `os.time(nil)` return one Number: the sampled millisecond word divided by 1000 with floor division. The result is a whole-second value in the range 0 through 4294967. Its wrap is still the wrap of the underlying 2³²-millisecond word, not a 2³²-second interval. This call takes its own sample; it does not reuse a preceding `os.clock()` reading.

Any argument other than nil selects civil conversion. In normal use, pass a Table containing the date fields described below. The function returns a whole-second timestamp and normalizes that same Table in place. It does not set the sampled clock.

### Civil timestamp convention

The civil-conversion formulas map timestamp 0 to the following fields:

| Field | Value |
| --- | --- |
| `year` | 1970 |
| `month` | 1 |
| `day` | 1 |
| `hour` | 0 |
| `min` | 0 |
| `sec` | 0 |
| `wday` | 5 |
| `yday` | 1 |
| `isdst` | false |

This origin belongs to civil-date conversion; it is independent of the running millisecond counter.

For example:

```lua
local date = { year = 1970, month = 1, day = 1, hour = 0 }
local timestamp = os.time(date)
```

Here `timestamp` is 0, and `date` receives all nine fields shown above. If `hour` had also been omitted, its default would have been 12, producing 43200 instead.

<div class="keep-together">

### Input fields, defaults, and bounds

Fields are read and checked in this exact order: `year`, `month`, `day`, `hour`, `min`, `sec`. Each field's lookup and validation finish before the next field is read.

| Field | Value when nil | Inclusive accepted integer range |
| --- | --- | --- |
| `year` | Required | −2147481748 through 2147485547 |
| `month` | Required | −2147483647 through 2147483648 |
| `day` | Required | −2147483648 through 2147483647 |
| `hour` | 12 | −2147483648 through 2147483647 |
| `min` | 0 | −2147483648 through 2147483647 |
| `sec` | 0 | −2147483648 through 2147483647 |

</div>

Only nil selects a missing-field error or an optional default. False is a supplied value, not a default. A nil optional field uses its default without undergoing the integer check.

For a supplied field, the integer check compares the value with the integer part returned by the retained `math.modf` function. There is no numeric-string conversion. Fractions, NaN, and non-Number field values fail this equality check. Numeric infinities pass the equality check but fail the subsequent field bounds check.

The field bounds are adjusted integer bounds, not conventional calendar limits. In particular, they do not restrict months to 1–12, hours to 0–23, or minutes and seconds to 0–59.

The only input fields used in the calculation are the six listed above. Existing `wday`, `yday`, and `isdst` fields do not affect the result.

### Normalization and result checking

Months first carry into the year. Days then participate arithmetically in the civil-date conversion; they are not checked against the selected month's length. Hours, minutes, and seconds contribute their corresponding numbers of seconds. Thus, outlying fields normalize through the combined timestamp rather than being rejected merely for crossing a calendar boundary.

For example:

```lua
local date = {
    year = 1970, month = 1, day = 1,
    hour = 25, min = 0, sec = 0
}
local timestamp = os.time(date)
```

This produces timestamp 90000 and normalizes the Table to 1970-01-02 at 01:00:00, together with its recomputed `wday`, `yday`, and `isdst` fields.

The combined timestamp is checked after all six input fields. It must first compare equal to its integer part, then lie within the inclusive range −9007199254740991 through 9007199254740991. These are separate checks from the input-field bounds. They apply to the computed Number, not an ideal unlimited-precision calculation: accepting the individual fields does not guarantee acceptance of their combination or exact intermediate arithmetic at every admitted magnitude.

Negative timestamps use floor-day decomposition. For example, timestamp −1 belongs to the day before timestamp 0, at 23:59:59; the day is not obtained by truncating toward zero.

### In-place Table update

<div class="keep-together">

After all six input validations and the combined timestamp check succeed, the function completes the inverse civil decomposition before making its first Table write. It then writes these fields in this order:

`year`, `month`, `day`, `hour`, `min`, `sec`, `wday`, `yday`, `isdst`.

</div>

`wday` uses a seven-day index. As a mathematical formula, with `days` denoting the floor-day index of the timestamp:

**weekday index = ((days + 4) modulo 7) + 1.**

`yday` is the one-based day within the resulting year. `isdst` is always written as false; no daylight-saving adjustment is applied.

The supplied Table is not replaced, and other fields are not cleared. Reads use ordinary field lookup, including Table-valued `__index` chains; function-valued `__index` entries are not called. The output stores go directly into the supplied Table and are not redirected through `__newindex`.

### Errors and their order

The messages below describe calls with the normally installed public `error` function.

Missing required fields produce these exact messages:

- `field 'year' missing in date table`
- `field 'month' missing in date table`
- `field 'day' missing in date table`

For each supplied field, the integer check precedes the bounds check. Their exact message forms are:

- `field '<field>' is not an integer`
- `field '<field>' is out-of-bound`

Here `<field>` is replaced by `year`, `month`, `day`, `hour`, `min`, or `sec`, as appropriate. Because fields are processed in order, a failure in an earlier field is reached before a later field is read.

After the fields, the combined timestamp checks use these exact messages, in order:

- `time is not an integer`
- `time is out-of-bound`

The conversion does not perform a separate top-level Table-type check before its first field read. For example, `os.time(false)` selects conversion and fails that read with `Attempted to index field on a non-table value.`; it does not behave like `os.time()`.

Ordinary indexing and assignment faults remain applicable. Their relevant messages are `Attempted to index field on a non-table value.`, `Attempted to assign to a non-table value.`, and `Metatable __index loop detected.` A String follows BLua's ordinary String-indexing rules rather than necessarily failing the first read.

### Work involved

The no-argument/nil form performs one time-word read and a division, without constructing a civil-date Table. Explicit-date conversion performs six field reads/checks, fixed calendar arithmetic and inverse decomposition, then nine stores into the existing Table. It does not advance through the intervening dates one by one. Ordinary Table lookup and storage, function calls, errors and faults retain their instruction costs.

## `os.difftime(t2, t1)` — subtract whole-second values

`os.difftime(t2, t1)` returns one Number, computed as the integer part of `t2` minus the integer part of `t1`, after checking that each argument equals its own integer part. For whole-second timestamps, the result is a signed difference in seconds: positive when `t2` is greater than `t1`.

```lua
local first = os.time({ year = 1970, month = 1, day = 1, hour = 0 })
local second = os.time({ year = 1970, month = 1, day = 2, hour = 0 })
local seconds = os.difftime(second, first)
-- seconds is 86400.
```

The function obtains the integer parts of `t2` and then `t1` before making either equality check. It then checks `t2` first and `t1` second. With the normally installed public `error`, the exact messages are:

- `os.difftime t2 must be an integer.`
- `os.difftime t1 must be an integer.`

Fractions, NaN, missing/nil arguments, false, and other non-Number values fail the corresponding equality check; numeric strings are not parsed. If both arguments fail, the `t2` message is reached first, although both integer-part calculations have already occurred.

Unlike civil conversion, this function does not apply either the civil-field bounds or the ±9007199254740991 timestamp bounds. Numeric infinities compare equal to their integer parts and pass these checks; their subtraction can produce infinity or NaN. The result is ordinary Number subtraction, not arbitrary-precision integer arithmetic.

`os.difftime()` does not sample the time word, invoke civil conversion, or repair the sampled word's wrap. In particular, subtracting `os.time()` readings across that wrap does not produce a wrap-adjusted elapsed duration. Its work consists of two integer-part calculations, the ordered equality checks and one subtraction.

### Retained dependencies and call arguments

The integer-part function used by the checks in `os.time()` and `os.difftime()` is retained during BIOS installation. Reassigning public `math`, or changing public `math.modf` afterward, does not rebind that retained function. Error calls, by contrast, use the public `error` name when reached; replacing it changes those calls and the rejection behavior described above.

These are fixed-parameter functions. Missing parameters are nil, and surplus arguments are ignored; there is no separate automatic argument-count error. Thus missing `date_table` selects the sampled-time form, whereas missing `t2` or `t1` is subject to the stated `os.difftime()` integer checks. See [known-call argument diagnostics](blua-programs.md#known-call-argument-diagnostics) for the corresponding direct-call source forms.

## Shared civil-day calculations

The calendar formulas use `D(year, month, day)` for the forward civil-day calculation and `C(days)` for its civil inverse. These are explanatory names, not public BIOS functions; the blocks below are formula notation rather than BLua programs. All arithmetic is ordinary Number arithmetic; `//` and `%` are not word operations. The written calculation order is significant: intermediate values have Number precision, not unlimited integer precision.

<div class="keep-together">

**Forward calculation: `D(year, month, day)`**

```text
if month <= 2: year = year - 1
era = year // 400
year_of_era = year - era * 400
month_prime = month + (if month > 2 then -3 else 9)
day_of_year = (153 * month_prime + 2) // 5
day_of_year = day_of_year + day - 1
day_of_era = year_of_era * 365 + year_of_era // 4
day_of_era = day_of_era - year_of_era // 100
day_of_era = day_of_era + day_of_year
result = era * 146097 + day_of_era - 719468
```

</div>

**Inverse calculation: `C(days)`**

```text
shifted = days + 719468
era = shifted // 146097
day_of_era = shifted - era * 146097
year_numerator = day_of_era - day_of_era // 1460
year_numerator = year_numerator + day_of_era // 36524
year_numerator = year_numerator - day_of_era // 146096
year_of_era = year_numerator // 365
year = year_of_era + era * 400
year_days = 365 * year_of_era + year_of_era // 4
year_days = year_days - year_of_era // 100
day_of_year = day_of_era - year_days
month_prime = (5 * day_of_year + 2) // 153
day = day_of_year - (153 * month_prime + 2) // 5 + 1
month = month_prime + (if month_prime < 10 then 3 else -9)
if month <= 2: year = year + 1
result = (year, month, day)
```

**Month normalization for `os.time`**

Before applying `D`, `os.time` calculates the normalized year and month as follows. The timestamp expression is split into successive additions to retain its calculation order.

```text
month_index = month - 1
year_offset = month_index // 12
normalized_year = year + year_offset
normalized_month = month_index - year_offset * 12 + 1
timestamp = D(normalized_year, normalized_month, day) * 86400
timestamp = timestamp + hour * 3600
timestamp = timestamp + min * 60
timestamp = timestamp + sec
```

The resulting timestamp then undergoes the ordinary time-value check. Timestamp decomposition and the date/week rules use the same `D` and `C` calculations.

## `os.date`

```lua
os.date(format, timestamp)
```

`os.date` returns one value: either a formatted String or a newly created Table. Choose the Table form when the individual calendar fields are needed; choose a format string when textual output is needed. It defines no date-specific processing for additional arguments.

<div class="keep-together">

### Selecting the result

Only `nil` selects a default. An omitted parameter is `nil` on an ordinary call.

| Argument | Selection |
|---|---|
| `format == nil` | Use `"%c"`. |
| A format beginning with `!` | Remove exactly one leading `!` before selecting the result kind. |
| Format exactly `"*t"` after that removal | Return a fresh Table. |
| Any other accepted format | Return a String. |
| `timestamp == nil` | Read the word at address `0x08010228` in this call and use that value `// 1000`. |
| Explicit timestamp | Apply the integer and range checks below. |

</div>

Thus `"*t"` and `"!*t"` select the Table result. `"!!*t"` does not: after removing one `!`, the remaining `"!*t"` is an ordinary format string. With a valid timestamp it is copied literally. The removed `!` is not retained as a mode flag and does not select a different calendar or time-zone calculation.

The order of operations is significant:

1. Select the format default.
2. Inspect the format and remove at most one leading `!`.
3. Select or validate the timestamp.
4. Check for the exact format `"*t"`.
5. Decompose the timestamp into calendar fields.
6. For a String result, scan the format.

An empty format therefore still selects or validates its timestamp before returning an empty String. An invalid conversion is not examined until after timestamp validation and calendar decomposition.

`false` is not a substitute for `nil`. A false format reaches the length operation within `string.sub` before timestamp processing and raises `Attempted to get length of an unsupported value.` (Lua reason 0); it does not produce a date-specific argument error. A false timestamp is passed to the retained `math.modf` function rather than selecting the default timestamp. Its integer check invokes `error` with `time is not an integer`, before the bounds check.

### Explicit timestamp checks

The explicit timestamp check first obtains the integer result of the retained `math.modf` function. In the supplied Math library, this truncates toward zero: for a negative value the calculation is `-((-value) // 1)`, otherwise it is `value // 1`.

If the retained integer differs from the input, the call invokes `error` with exactly:

```text
time is not an integer
```

<div class="keep-together">

Only after that check does it require the integer to lie within the inclusive range `-0x1fffffffffffff` through `0x1fffffffffffff`. A value outside that range invokes `error` with exactly:

```text
time is out-of-bound
```

</div>

The accepted integer is then used for decomposition. There is no separate date-specific type-dispatch or numeric-text parsing layer. The default timestamp read is not passed through these explicit-timestamp checks.

### Table result and calendar fields

The `"*t"` form creates a new Table on every call and writes exactly these fields:

| Field | Meaning |
|---|---|
| `year` | Civil year. |
| `month` | Civil month, with January numbered 1. |
| `day` | Day of the civil month. |
| `hour` | Hour derived from the seconds within the day. |
| `min` | Minute within that hour. |
| `sec` | Remaining seconds within that minute. |
| `wday` | Weekday with Sunday numbered 1 and Saturday numbered 7. |
| `yday` | Day of the civil year, with January 1 numbered 1. |
| `isdst` | Always `false`. |

This form does not consume a caller-supplied date Table. It returns the newly created Table itself.

The following is documentary formula notation, not a BLua program. The [shared civil-day calculations](#shared-civil-day-calculations) above define `D(y, m, d)` and `C(days)`; both result forms use those same calculations.

```text
days           = timestamp // 86400
seconds_of_day = timestamp - days * 86400
(year, month, day) = C(days)
hour           = seconds_of_day // 3600
min            = (seconds_of_day - hour * 3600) // 60
sec            = seconds_of_day - hour * 3600 - min * 60
yday           = days - D(year, 1, 1) + 1
wday           = ((days + 4) % 7) + 1
```

The Table and String forms use this same decomposition, including after a leading `!`.

### Format grammar

The formatter scans String codepoints, not UTF-8 byte offsets. Every codepoint other than `%` is copied literally. A `%` consumes one following conversion code; it may first consume exactly one `E` or `O` modifier.

<div class="keep-together">

There are no format flags, field-width syntax, precision syntax, repeated modifiers, or alternative escape introducers. The letters in the modifier table are the complete permitted sets:

| Modifier | Permitted following codes | Effect |
|---|---|---|
| `E` | `c C x X y Y` | Use exactly the corresponding unmodified conversion. |
| `O` | `d e H I m M S u U V w W y` | Use exactly the corresponding unmodified conversion. |

</div>

The modifier is checked before conversion dispatch. It does not select alternative names, digits, or eras. For example, `%Ec` follows the `%c` path and `%OV` follows the `%V` path. A code may be accepted without a modifier but rejected with one.

#### Conversions

In this table, `Z(value, n)` means: obtain the value's text with the current global `tostring`, then prepend `0` until the total text length is at least `n`. `S(value, n)` does the same with spaces. These are explanatory symbols, not callable BLua functions. Neither operation truncates text or places padding specially around a sign. The numeric-text limitations below apply to every such entry.

`hour12` is 12 when `hour % 12 == 0`, otherwise `hour % 12`. `AMPM` is `AM` when `hour < 12`, otherwise `PM`. `iso_year`, `iso_week`, `sunday_week`, and `monday_week` are defined under Week numbering.

#### Calendar fields

| Conversion | Output |
|---|---|
| `%C` | `Z(year // 100, 2)` |
| `%D`, `%x` | `Z(month, 2)/Z(day, 2)/Z(year % 100, 2)` |
| `%F` | `Z(year, 4)-Z(month, 2)-Z(day, 2)` |
| `%G` | `Z(iso_year, 4)` |
| `%g` | `Z(iso_year % 100, 2)` |
| `%Y` | `Z(year, 4)` |
| `%y` | `Z(year % 100, 2)` |
| `%m` | `Z(month, 2)` |
| `%d` | `Z(day, 2)` |
| `%e` | `S(day, 2)` |

#### Time of day

| Conversion | Output |
|---|---|
| `%H` | `Z(hour, 2)` |
| `%M` | `Z(min, 2)` |
| `%S` | `Z(sec, 2)` |
| `%I` | `Z(hour12, 2)` |
| `%R` | `Z(hour, 2):Z(min, 2)` |
| `%r` | `Z(hour12, 2):Z(min, 2):Z(sec, 2) AMPM` |
| `%T`, `%X` | `Z(hour, 2):Z(min, 2):Z(sec, 2)` |
| `%p` | `AMPM` |

#### Names and day of year

| Conversion | Output |
|---|---|
| `%a` | Short weekday name. |
| `%A` | Long weekday name. |
| `%h`, `%b` | Short month name. |
| `%B` | Long month name. |
| `%j` | `Z(yday, 3)` |

#### Literal characters

| Conversion | Output |
|---|---|
| `%n` | One newline codepoint. |
| `%t` | One tab codepoint. |

#### Week numbers and composite output

| Conversion | Output |
|---|---|
| `%U` | `Z(sunday_week, 2)` |
| `%u` | `tostring(wday == 1 and 7 or wday - 1)`, without padding: Monday 1 through Sunday 7. |
| `%V` | `Z(iso_week, 2)` |
| `%w` | `tostring(wday - 1)`, without padding: Sunday 0 through Saturday 6. |
| `%W` | `Z(monday_week, 2)` |
| `%c` | `shortWeekday shortMonth Z(day, 2) Z(hour, 2):Z(min, 2):Z(sec, 2) Z(year, 4)` |
| `%z` | Literal `+0000`. |
| `%Z` | Literal `BMSX`. |
| `%%` | Literal `%`. |

Slashes, hyphens, colons, and spaces shown between components are literal characters. In particular, `%c` has one space between each displayed component and uses a **zero-padded** day, not the space-padded `%e` conversion.

The names are fixed, not locale lookups:

| Kind | Names in index order |
|---|---|
| Short weekdays | `Sun Mon Tue Wed Thu Fri Sat` |
| Long weekdays | `Sunday Monday Tuesday Wednesday Thursday Friday Saturday` |
| Short months | `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec` |
| Long months | `January February March April May June July August September October November December` |

#### Week numbering

The following formulas are explanatory notation. They use the decomposed civil year and the `D` civil-day calculation defined above.

```text
sunday_week = (yday - 1 + 7 - (wday - 1)) // 7
monday_week = (yday - 1 + 7 - ((wday + 5) % 7)) // 7
```

For `%U`, week 0 is the part of the year before its first Sunday; week 1 starts on that Sunday. For `%W`, the corresponding boundary is Monday. These two conversions do not adjust the civil year.

The ISO conversions first remap weekdays to Monday 1 through Sunday 7, then calculate:

```text
iso_weekday = 7 if wday == 1, otherwise wday - 1
candidate   = (yday - iso_weekday + 10) // 7
```

An ISO year has 53 weeks exactly when its January 1 is Thursday, or when January 1 is Wednesday and the difference `D(year + 1, 1, 1) - D(year, 1, 1)` is 366. Otherwise it has 52 weeks. The January 1 weekday for this rule is `((D(year, 1, 1) + 3) % 7) + 1`, with Monday numbered 1.

If the candidate is below 1, `iso_year` is the preceding civil year and `iso_week` is that year's week count. If the candidate exceeds the current year's week count, `iso_year` is the following civil year and `iso_week` is 1. Otherwise `iso_year` is the civil year and `iso_week` is the candidate. `%G` and `%g` format this ISO year, not necessarily the year used by `%Y` and `%y`.

#### Invalid conversions and embedded zero

Any unsupported conversion invokes the current global `error` with this assembled message:

```text
invalid conversion specifier '%<modifier><code>'
```

Here `<modifier>` is empty, `E`, or `O`, and `<code>` is the consumed codepoint. These angle-bracket terms describe assembly; they are not literal message text. With an unfinished conversion, the absent code is the empty String:

| Format ending | Error String |
|---|---|
| `%` | `invalid conversion specifier '%'` |
| `%E` | `invalid conversion specifier '%E'` |
| `%O` | `invalid conversion specifier '%O'` |
| `%EO` | `invalid conversion specifier '%EO'` |

In `%EO`, `O` is checked as the code after `E`; it is not parsed as a second modifier.

A zero codepoint is not a String terminator. An embedded literal zero is copied and scanning continues. A zero used as the code after `%` is unsupported; the assembled error message contains that zero codepoint.

### Numeric text and padding limits

Padding operates on the complete text returned by the current global `tostring`. For example, zero-prepending the text of `-1` to a minimum length of four produces `00-1`, not `-001`. A padding width is a minimum total text length, not a fixed digit count.

<div class="keep-together">

With the supplied `tostring`, numbers use the shared numeric-text conversion:

- Zero has signed-zero handling.
- Integral magnitudes strictly below `1,000,000` use complete ordinary decimal integer text.
- Other finite values are normalized to a decimal exponent and rounded to six significant digits, with ties to even.
- After rounding, fixed form is selected when the adjusted exponent is at least `-4` and below `6`; otherwise scientific form is selected.
- Scientific form uses lowercase `e`, an explicit exponent sign, and at least two exponent digits. Trailing fractional zeros and a trailing decimal point are removed.

</div>

The formatter pads that result unchanged. `%Y`, `%G` and `%C` can therefore contain rounded scientific text for large years or centuries. `%Y` is padded to a minimum length of four, not constrained to four decimal digits. Calendar arithmetic uses Number operations, including at the extremes of the accepted timestamp range.

### Dependencies and amount of work

During BIOS installation, the OS library obtains the String and Math tables. Its later calls retain the String table reference and the `math.modf` function obtained then. Later timestamp validation uses that retained function. Calls to `string.sub` look up the `sub` field on the retained String table each time: replacing the global `string` binding does not change that table reference, but changing that table's `sub` field changes the function used. Global `tostring` and `error` are looked up when needed, rather than captured at initialization.

The Table form performs one calendar decomposition and writes its fields. It skips format scanning, name output, week formatting, and padding. The String form performs one initial decomposition, then builds its result through growing concatenation. Each occurrence of `%G`, `%g`, `%V`, or the accepted `%OV` independently calculates the ISO year/week pair; the pair is not cached for the call.

A literal advances the scanner by one codepoint, a plain conversion by two, and a modified conversion by three. Calendar conversion uses arithmetic and conditionals rather than traversing every intervening day or year. Padding prepends one character per iteration until the minimum text length is reached.

The supplied codepoint lookup scans from the beginning of a String to the requested position, so repeated single-codepoint slices do not provide constant-time random access. Removing a leading `!` may also construct a tail slice; multi-codepoint slices use a temporary character collection and concatenation.

The fixed `%z`, `%Z` and `isdst` values are output conventions, not time-zone or daylight-saving calculations.
