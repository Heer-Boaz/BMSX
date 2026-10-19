# BIOS time and calendar services {#sec-bios-os}

The BIOS provides sampled elapsed time and civil-date conversion through the
`os` Table. Use `clock` or the no-argument `time` form to sample system time.
Use explicit timestamps with `time(date)` and `date(format, timestamp)` for
stored calendar dates. `difftime` subtracts whole-second values.

The sampled counter is the system millisecond word, not a calendar clock.
Civil conversion uses its own 1970 epoch and fixed BMSX zone convention.
The [[system-control reference](system.md#sec-system)]{.content-visible when-format="html"}[Book I, “System control and timing”]{.content-visible when-format="pdf"} specifies the underlying counter;
[Number arithmetic](cpu.md#sec-cpu-values-and-numeric-instructions) determines
precision in date calculations. These services provide no filesystem or
process operations.

| Call | Returned value | Operation |
| --- | --- | --- |
| `os.clock()` | One Number, seconds | Sample the millisecond word and divide by 1000. |
| `os.time(date_table)` | One Number, whole seconds | With nil, sample time; otherwise normalize the supplied civil fields in place and return their timestamp. |
| `os.date(format, timestamp)` | One String or new Table | Format or decompose the selected timestamp. |
| `os.difftime(t2, t1)` | One Number, seconds | Check each argument against its integer component, then subtract. |

Use sampled time for intervals within one counter range. Use an explicit
civil timestamp for stored dates. Passing a sampled `os.time()` result to
`os.date()` applies the civil epoch to that number; it does not obtain the
current calendar date from a clock or preserve elapsed time across counter
wrap. The two uses share seconds as a unit, not a common time origin.


## Example: time and calendar operations {#sec-bios-os-example-time-and-calendar-operations}

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


## `os.clock()` — sampled time in seconds {#sec-bios-os-osclock-sampled-time-in-seconds}

`os.clock()` returns one Number: the current sampled millisecond word divided by 1000. Use it when a seconds value with millisecond granularity is more useful than the whole-second result of `os.time()`.

The sampled word contains whole milliseconds modulo 2³². `os.clock()`
therefore ranges from 0 through 4294967.295 seconds and wraps to zero with
that word. Decimal millisecond fractions are rounded to Number precision.
The counter measures system time, including intervals when a particular
program is not executing.

For example, two readings can be subtracted to measure a span within the same uninterrupted counter range:

```lua
local before = os.clock()
-- Perform the work being measured.
local after = os.clock()
local elapsed = after - before
```

Each call takes a new sample. If the word wraps between readings, direct
subtraction crosses that discontinuity. Track wrap at the counter level when
an interval must span it; `os.difftime` also performs ordinary subtraction.

## `os.time([date_table])` — whole seconds or civil conversion {#sec-bios-os-ostimedate_table-whole-seconds-or-civil-conversion}

`os.time()` and `os.time(nil)` return one Number: the sampled millisecond word divided by 1000 with floor division. The result is a whole-second value in the range 0 through 4294967. Its wrap is still the wrap of the underlying 2³²-millisecond word, not a 2³²-second interval. This call takes its own sample; it does not reuse a preceding `os.clock()` reading.

Supply a date Table for civil conversion. The result is a whole-second
timestamp, and the same Table receives normalized calendar fields. Nil
selects sampling; every other supplied value selects the date-field route.
Conversion leaves the sampled clock unchanged.


### Civil timestamp convention {#sec-bios-os-civil-timestamp-convention}

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


### Input fields, defaults, and bounds {#sec-bios-os-input-fields-defaults-and-bounds}

Fields are read and checked in this exact order: `year`, `month`, `day`, `hour`, `min`, `sec`. Each field's lookup and validation finish before the next field is read.

| Field | Value when nil | Inclusive accepted integer range |
| --- | --- | --- |
| `year` | Required | −2147481748 through 2147485547 |
| `month` | Required | −2147483647 through 2147483648 |
| `day` | Required | −2147483648 through 2147483647 |
| `hour` | 12 | −2147483648 through 2147483647 |
| `min` | 0 | −2147483648 through 2147483647 |
| `sec` | 0 | −2147483648 through 2147483647 |


Only nil selects a missing-field error or an optional default. False is a supplied value, not a default. A nil optional field uses its default without undergoing the integer check.

A supplied field must equal its truncated integer component and pass the
listed bounds. Fractions, NaN and non-Number values fail the integer test;
infinities fail the bounds test. Supply Numbers, not numeric Strings.

Out-of-range calendar fields within those numeric bounds normalize
arithmetically. For example, month 13 carries into the next year and hour 25
carries into the next day. Only the six listed fields contribute to the
timestamp; `wday`, `yday` and `isdst` are recomputed outputs.

### Normalization and result checking {#sec-bios-os-normalization-and-result-checking}

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

After the six fields pass, their combined timestamp must equal its integer
component and lie in the inclusive range −9007199254740991 through
9007199254740991. Intermediate arithmetic uses Number precision, so the
combined calculation can fail even when each individual field is accepted.

Negative timestamps use floor-day decomposition. For example, timestamp −1 belongs to the day before timestamp 0, at 23:59:59; the day is not obtained by truncating toward zero.

### In-place Table update {#sec-bios-os-in-place-table-update}


After all six input validations and the combined timestamp check succeed, the function completes the inverse civil decomposition before making its first Table write. It then writes these fields in this order:

`year`, `month`, `day`, `hour`, `min`, `sec`, `wday`, `yday`, `isdst`.


`wday` uses a seven-day index. As a mathematical formula, with `days` denoting the floor-day index of the timestamp:

**weekday index = ((days + 4) modulo 7) + 1.**

`yday` is the one-based day within the resulting year. `isdst` is always written as false; no daylight-saving adjustment is applied.

The supplied Table is not replaced, and other fields are not cleared. Reads use ordinary field lookup, including Table-valued `__index` chains; function-valued `__index` entries are not called. The output stores go directly into the supplied Table and are not redirected through `__newindex`.

### Errors and their order {#sec-bios-os-errors-and-their-order}

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

Date fields use ordinary indexed reads and writes. Passing false selects
conversion and fails its first field read with
`Attempted to index field on a non-table value.` Other indexed-access errors
retain their ordinary texts, including
`Attempted to assign to a non-table value.` and
`Metatable __index loop detected.`

### Work involved {#sec-bios-os-work-involved}

Sampling reads one time word and divides. Date conversion reads six input
fields, calculates the timestamp and normalized date, then writes nine
fields. Its calendar calculation uses arithmetic rather than advancing one
day at a time. Ordinary calls, field accesses and arithmetic contribute their
CPU instruction costs.

## `os.difftime(t2, t1)` — subtract whole-second values {#sec-bios-os-osdifftimet2-t1-subtract-whole-second-values}

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

The operands are checked for integer equality without the civil-field or
timestamp bounds. Infinities therefore pass those checks; their subtraction
can yield infinity or NaN. The result uses ordinary Number precision.

`difftime` reads no clock and applies no calendar conversion. For samples
straddling the millisecond-counter wrap, account for the discontinuity before
using ordinary whole-second subtraction.

### Retained dependencies and call arguments {#sec-bios-os-retained-dependencies-and-call-arguments}

Integer checks use the truncation function saved at BIOS installation;
replacing public `math.modf` leaves those checks unchanged. Reported errors
call the current global `error`.

Missing fixed parameters are nil and surplus arguments are ignored. Thus an
omitted date Table selects sampling, while missing `difftime` operands fail
their integer checks. [BLua source-call diagnostics](blua-programs.md#sec-blua-programs-known-call-argument-diagnostics)
also apply when the callee signature is known at compilation.

## Shared civil-day calculations {#sec-bios-os-shared-civil-day-calculations}

The formulas below define `D(year, month, day)`, the civil-day index, and
`C(days)`, its inverse. They use Number arithmetic in the written order,
including `//` and `%`. These are reference formulas, not additional BIOS
functions or BLua program listings.


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


## `os.date` {#sec-bios-os-osdate}

```lua
os.date(format, timestamp)
```

`os.date` returns one value: either a formatted String or a newly created Table. Choose the Table form when the individual calendar fields are needed; choose a format string when textual output is needed. It defines no date-specific processing for additional arguments.



### Selecting the result {#sec-bios-os-selecting-the-result}

Only `nil` selects a default. An omitted parameter is `nil` on an ordinary call.

| Argument | Selection |
|---|---|
| `format == nil` | Use `"%c"`. |
| A format beginning with `!` | Remove exactly one leading `!` before selecting the result kind. |
| Format exactly `"*t"` after that removal | Return a fresh Table. |
| Any other accepted format | Return a String. |
| `timestamp == nil` | Read the word at address `0x08010228` in this call and use that value `// 1000`. |
| Explicit timestamp | Apply the integer and range checks below. |


Thus `"*t"` and `"!*t"` select the Table result. `"!!*t"` does not: after removing one `!`, the remaining `"!*t"` is an ordinary format string. With a valid timestamp it is copied literally. The removed `!` is not retained as a mode flag and does not select a different calendar or time-zone calculation.

`date` selects the format, removes one leading `!`, then selects or checks
the timestamp. It decomposes the calendar fields before producing the chosen
Table or scanning a String format. An empty format still checks its timestamp;
a malformed conversion is reached after timestamp processing.

`false` is not a substitute for `nil`. A false format reaches the length operation within `string.sub` before timestamp processing and raises `Attempted to get length of an unsupported value.` (Lua reason 0); it does not produce a date-specific argument error. A false timestamp is passed to the retained `math.modf` function rather than selecting the default timestamp. Its integer check invokes `error` with `time is not an integer`, before the bounds check.

### Explicit timestamp checks {#sec-bios-os-explicit-timestamp-checks}

The explicit timestamp check first obtains the integer result of the retained `math.modf` function. In the supplied Math library, this truncates toward zero: for a negative value the calculation is `-((-value) // 1)`, otherwise it is `value // 1`.

If the retained integer differs from the input, the call invokes `error` with exactly:

```text
time is not an integer
```


Only after that check does it require the integer to lie within the inclusive range `-0x1fffffffffffff` through `0x1fffffffffffff`. A value outside that range invokes `error` with exactly:

```text
time is out-of-bound
```


The accepted integer is then used for decomposition. There is no separate date-specific type-dispatch or numeric-text parsing layer. The default timestamp read is not passed through these explicit-timestamp checks.

### Table result and calendar fields {#sec-bios-os-table-result-and-calendar-fields}

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

The following is documentary formula notation, not a BLua program. The [shared civil-day calculations](#sec-bios-os-shared-civil-day-calculations) above define `D(y, m, d)` and `C(days)`; both result forms use those same calculations.

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

### Format grammar {#sec-bios-os-format-grammar}

The formatter scans String codepoints, not UTF-8 byte offsets. Every codepoint other than `%` is copied literally. A `%` consumes one following conversion code; it may first consume exactly one `E` or `O` modifier.


There are no format flags, field-width syntax, precision syntax, repeated modifiers, or alternative escape introducers. The letters in the modifier table are the complete permitted sets:

| Modifier | Permitted following codes | Effect |
|---|---|---|
| `E` | `c C x X y Y` | Use exactly the corresponding unmodified conversion. |
| `O` | `d e H I m M S u U V w W y` | Use exactly the corresponding unmodified conversion. |


The modifier is checked before conversion dispatch. It does not select alternative names, digits, or eras. For example, `%Ec` follows the `%c` path and `%OV` follows the `%V` path. A code may be accepted without a modifier but rejected with one.

#### Conversions {#sec-bios-os-conversions}

In this table, `Z(value, n)` means: obtain the value's text with the current global `tostring`, then prepend `0` until the total text length is at least `n`. `S(value, n)` does the same with spaces. These are explanatory symbols, not callable BLua functions. Neither operation truncates text or places padding specially around a sign. The numeric-text limitations below apply to every such entry.

`hour12` is 12 when `hour % 12 == 0`, otherwise `hour % 12`. `AMPM` is `AM` when `hour < 12`, otherwise `PM`. `iso_year`, `iso_week`, `sunday_week`, and `monday_week` are defined under Week numbering.

#### Calendar fields {#sec-bios-os-calendar-fields}

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

#### Time of day {#sec-bios-os-time-of-day}

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

#### Names and day of year {#sec-bios-os-names-and-day-of-year}

| Conversion | Output |
|---|---|
| `%a` | Short weekday name. |
| `%A` | Long weekday name. |
| `%h`, `%b` | Short month name. |
| `%B` | Long month name. |
| `%j` | `Z(yday, 3)` |

#### Literal characters {#sec-bios-os-literal-characters}

| Conversion | Output |
|---|---|
| `%n` | One newline codepoint. |
| `%t` | One tab codepoint. |

#### Week numbers and composite output {#sec-bios-os-week-numbers-and-composite-output}

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

#### Week numbering {#sec-bios-os-week-numbering}

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

#### Invalid conversions and embedded zero {#sec-bios-os-invalid-conversions-and-embedded-zero}

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

### Numeric text and padding limits {#sec-bios-os-numeric-text-and-padding-limits}

Padding operates on the complete text returned by the current global `tostring`. For example, zero-prepending the text of `-1` to a minimum length of four produces `00-1`, not `-001`. A padding width is a minimum total text length, not a fixed digit count.


With the supplied `tostring`, numbers use the shared numeric-text conversion:

- Zero has signed-zero handling.
- Integral magnitudes strictly below `1,000,000` use complete ordinary decimal integer text.
- Other finite values are normalized to a decimal exponent and rounded to six significant digits, with ties to even.
- After rounding, fixed form is selected when the adjusted exponent is at least `-4` and below `6`; otherwise scientific form is selected.
- Scientific form uses lowercase `e`, an explicit exponent sign, and at least two exponent digits. Trailing fractional zeros and a trailing decimal point are removed.


The formatter pads that result unchanged. `%Y`, `%G` and `%C` can therefore contain rounded scientific text for large years or centuries. `%Y` is padded to a minimum length of four, not constrained to four decimal digits. Calendar arithmetic uses Number operations, including at the extremes of the accepted timestamp range.

### Library bindings and execution cost {#sec-bios-os-library-bindings-and-execution-cost}

Date validation retains its installation-time truncation function. Formatting
uses `sub` from the original String Table, while `tostring` and `error` are
read through their current global bindings. Replacing the `string` global
leaves that original Table in use; replacing its `sub` field changes slicing.

The Table result performs one calendar decomposition and stores the nine
fields. String output additionally scans and concatenates text. ISO-week
conversions calculate their year/week pair for each occurrence, and padding
adds characters until the requested minimum length is reached. Format length,
selected conversions and output size therefore affect execution cost.

`%z`, `%Z` and `isdst` always use the fixed values listed above. They represent
the BIOS civil-time convention rather than a configurable zone or
daylight-saving rule.
