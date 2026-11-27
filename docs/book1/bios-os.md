# BIOS time and calendar services {#sec-bios-os}

The `os` table provides the time since the console was switched on and
conversion between dates and timestamps. The time comes from the
[TIME_MS counter](system.md#sec-system-system-time-and-frame-timing); it is not
a calendar clock. Dates use timestamps in seconds since 1970-01-01 00:00:00, in
the fixed BMSX zone (no time zones, no daylight saving).

| Function | Result |
| --- | --- |
| `os.clock()` | Time since switch-on, in seconds (Float) |
| `os.time()` | Time since switch-on, in whole seconds |
| `os.time(date)` | Timestamp of a date |
| `os.date(format, timestamp)` | Date as text or as a table |
| `os.difftime(t2, t1)` | t2 − t1 |

The time since switch-on and timestamps are both in seconds, but have
different origins: `os.date(..., os.time())` does not give today's date.

## Example {#sec-bios-os-example-time-and-calendar-operations}

```lua
local date = { year = 2024, month = 2, day = 28, hour = 25, min = 2, sec = 3 }
local timestamp = os.time(date)             -- 1709168523
-- date is now 2024-02-29 01:02:03, wday = 5, yday = 60, isdst = false
local fields = os.date('*t', timestamp)
local label = os.date('%F %T', timestamp)   -- '2024-02-29 01:02:03'
local elapsed = os.difftime(timestamp, timestamp - 90) -- 90
```

| Call | Result |
| --- | --- |
| `os.date('%F %G-W%V-%u', 1609459200)` | `'2021-01-01 2020-W53-5'` |
| `os.date('%F %G-W%V-%u', 1546214400)` | `'2018-12-31 2019-W01-1'` |
| `os.date('%c', 0)` | `'Thu Jan 01 00:00:00 1970'` |
| `os.date('%F %T', -1)` | `'1969-12-31 23:59:59'` |
| `os.date('offset %z zone %Z %%', 0)` | `'offset +0000 zone BMSX %'` |

## os.clock {#sec-bios-os-osclock-sampled-time-in-seconds}

```text
os.clock() -> seconds
```

Returns TIME_MS / 1000 as a Float. At large values the Float no longer shows
every millisecond; use TIME_MS itself for full precision. The counter wraps
after 2^32^ ms (about 49.7 days); a difference across the wrap is wrong.

```lua
local before = os.clock()
-- Work to be measured.
local elapsed = os.clock() - before
```

## os.time {#sec-bios-os-ostimedate_table-whole-seconds-or-civil-conversion}

```text
os.time() -> seconds
os.time(date) -> timestamp
```

Without an argument (or with nil), returns TIME_MS // 1000 as an Integer
(0 to 4294967).

With a date table, returns its timestamp and corrects the table (see below).

### Timestamps {#sec-bios-os-civil-timestamp-convention}

A timestamp is a signed 32-bit number of seconds, from 1901-12-13 20:45:52
(−2147483648) to 2038-01-19 03:14:07 (2147483647). Dates outside this range
raise an error. Timestamp 0:

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

```lua
local date = { year = 1970, month = 1, day = 1, hour = 0 }
local timestamp = os.time(date)   -- 0
```

Without `hour`, the result would be 43200 (12:00).

### Fields {#sec-bios-os-input-fields-defaults-and-bounds}

| Field | Default | Range |
| --- | --- | --- |
| `year` | Required | 32-bit integer |
| `month` | Required | 32-bit integer |
| `day` | Required | 32-bit integer |
| `hour` | 12 | 32-bit integer |
| `min` | 0 | 32-bit integer |
| `sec` | 0 | 32-bit integer |

The fields are checked in this order. Each must be a number with an integer
value; strings are not converted. `wday`, `yday` and `isdst` are not read.

### Correction {#sec-bios-os-normalization-and-result-checking}

Values outside the usual range carry over: month 13 is January of the next
year, hour 25 is 01:00 of the next day.

```lua
local date = { year = 1970, month = 1, day = 1, hour = 25, min = 0, sec = 0 }
local timestamp = os.time(date)   -- 90000; date becomes 1970-01-02 01:00:00
```

Only the final timestamp must lie in the range above. Negative timestamps are
divided into days by rounding down: −1 is 23:59:59 on the day before.

### The table {#sec-bios-os-in-place-table-update}

If the date is valid, os.time writes into the table, in this order: `year`,
`month`, `day`, `hour`, `min`, `sec`, `wday`, `yday`, `isdst`. `wday` is the
weekday (Sunday 1 to Saturday 7):

```text
wday = ((days + 4) mod 7) + 1        days = timestamp // 86400
```

`yday` is the day of the year (from 1) and `isdst` is always false. Other
fields of the table are kept. On an error the table is not changed.

### Errors {#sec-bios-os-errors-and-their-order}

| Error | Message |
| --- | --- |
| Missing field | `field 'year' missing in date table` (also `month`, `day`) |
| Not an integer | `field '<field>' is not an integer` |
| Out of range | `field '<field>' is out-of-bound` |
| Timestamp out of range | `time is out-of-bound` |
| Not a table | `Attempted to index field on a non-table value.` |

### Time {#sec-bios-os-work-involved}

The conversion is a fixed calculation; its time does not depend on the date.

## os.difftime {#sec-bios-os-osdifftimet2-t1-subtract-whole-second-values}

```text
os.difftime(t2, t1) -> t2 − t1
```

Both must be numbers with integer values: otherwise
`os.difftime t2 must be an integer.` or `os.difftime t1 must be an integer.`
(t2 is checked first). The result is an Integer, or a Float if it does not fit.

```lua
local first = os.time({ year = 1970, month = 1, day = 1, hour = 0 })
local second = os.time({ year = 1970, month = 1, day = 2, hour = 0 })
local seconds = os.difftime(second, first) -- 86400
```

### Globals used {#sec-bios-os-retained-dependencies-and-call-arguments}

The os functions keep the number functions they had at installation. Errors
are raised with the current global `error`.

## Calendar calculation {#sec-bios-os-shared-civil-day-calculations}

D(year, month, day) gives the day number (0 = 1970-01-01), C(days) the date.
`//` is division rounded down and `%` its remainder.

**D(year, month, day)**

```text
if month <= 2: year = year - 1
era = year // 400
year_of_era = year - era * 400
month_prime = month + (if month > 2 then -3 else 9)
day_of_year = (153 * month_prime + 2) // 5 + day - 1
day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
result = era * 146097 + day_of_era - 719468
```

**C(days)**

```text
shifted = days + 719468
era = shifted // 146097
day_of_era = shifted - era * 146097
year_of_era = (day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096) // 365
year = year_of_era + era * 400
day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
month_prime = (5 * day_of_year + 2) // 153
day = day_of_year - (153 * month_prime + 2) // 5 + 1
month = month_prime + (if month_prime < 10 then 3 else -9)
if month <= 2: year = year + 1
```

**os.time**

```text
month_index = month - 1
year = year + month_index // 12
month = month_index % 12 + 1
timestamp = D(year, month, day) * 86400 + hour * 3600 + min * 60 + sec
```

## os.date {#sec-bios-os-osdate}

```text
os.date([format [, timestamp]]) -> text or table
```

### Arguments {#sec-bios-os-selecting-the-result}

| Argument | Meaning |
|---|---|
| format nil | `"%c"` |
| format beginning with `!` | One `!` is removed; it has no other effect |
| format `"*t"` (after that) | Return a table |
| Other format | Return text |
| timestamp nil | TIME_MS // 1000 |

So `"*t"` and `"!*t"` give a table; `"!!*t"` gives the text `!*t`. false is not
the same as nil: a false format or timestamp raises an error.

### Timestamp {#sec-bios-os-explicit-timestamp-checks}

The timestamp must be a number with an integer value (`time is not an integer`)
within the timestamp range (`time is out-of-bound`).

### The table {#sec-bios-os-table-result-and-calendar-fields}

`"*t"` returns a new table with `year`, `month`, `day`, `hour`, `min`, `sec`,
`wday` (Sunday = 1), `yday` (1 January = 1) and `isdst` (false):

```text
days = timestamp // 86400
seconds_of_day = timestamp - days * 86400
(year, month, day) = C(days)
hour = seconds_of_day // 3600
min = (seconds_of_day - hour * 3600) // 60
sec = seconds_of_day - hour * 3600 - min * 60
yday = days - D(year, 1, 1) + 1
wday = ((days + 4) % 7) + 1
```

### Format {#sec-bios-os-format-grammar}

Characters other than `%` are copied. `%` is followed by a conversion code,
optionally preceded by `E` or `O`:

| Modifier | Allowed with | Effect |
|---|---|---|
| `E` | `c C x X y Y` | None |
| `O` | `d e H I m M S u U V w W y` | None |

There are no widths, flags or precisions.

#### Conversions {#sec-bios-os-conversions}

In the tables, Z(v, n) is `tostring(v)` padded with zeros on the left to at
least n characters; S(v, n) the same with spaces. hour12 is hour % 12, or 12 if
that is 0; AMPM is `AM` before 12:00, otherwise `PM`.

#### Date {#sec-bios-os-calendar-fields}

| Code | Output |
|---|---|
| `%C` | Z(year // 100, 2) |
| `%D`, `%x` | Z(month, 2)/Z(day, 2)/Z(year % 100, 2) |
| `%F` | Z(year, 4)-Z(month, 2)-Z(day, 2) |
| `%G` | Z(iso_year, 4) |
| `%g` | Z(iso_year % 100, 2) |
| `%Y` | Z(year, 4) |
| `%y` | Z(year % 100, 2) |
| `%m` | Z(month, 2) |
| `%d` | Z(day, 2) |
| `%e` | S(day, 2) |

#### Time {#sec-bios-os-time-of-day}

| Code | Output |
|---|---|
| `%H` | Z(hour, 2) |
| `%M` | Z(min, 2) |
| `%S` | Z(sec, 2) |
| `%I` | Z(hour12, 2) |
| `%R` | Z(hour, 2):Z(min, 2) |
| `%r` | Z(hour12, 2):Z(min, 2):Z(sec, 2) AMPM |
| `%T`, `%X` | Z(hour, 2):Z(min, 2):Z(sec, 2) |
| `%p` | AMPM |

#### Names {#sec-bios-os-names-and-day-of-year}

| Code | Output |
|---|---|
| `%a` | Short weekday name |
| `%A` | Weekday name |
| `%h`, `%b` | Short month name |
| `%B` | Month name |
| `%j` | Z(yday, 3) |

#### Characters {#sec-bios-os-literal-characters}

| Code | Output |
|---|---|
| `%n` | Line feed |
| `%t` | Tab |

#### Weeks and others {#sec-bios-os-week-numbers-and-composite-output}

| Code | Output |
|---|---|
| `%U` | Z(sunday_week, 2) |
| `%u` | Weekday, Monday 1 to Sunday 7 |
| `%V` | Z(iso_week, 2) |
| `%w` | Weekday, Sunday 0 to Saturday 6 |
| `%W` | Z(monday_week, 2) |
| `%c` | Short weekday, short month, Z(day, 2), Z(hour, 2):Z(min, 2):Z(sec, 2), Z(year, 4), separated by spaces |
| `%z` | `+0000` |
| `%Z` | `BMSX` |
| `%%` | `%` |

| Names | |
|---|---|
| Short weekdays | `Sun Mon Tue Wed Thu Fri Sat` |
| Weekdays | `Sunday Monday Tuesday Wednesday Thursday Friday Saturday` |
| Short months | `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec` |
| Months | `January February March April May June July August September October November December` |

#### Week numbers {#sec-bios-os-week-numbering}

```text
sunday_week = (yday - 1 + 7 - (wday - 1)) // 7
monday_week = (yday - 1 + 7 - ((wday + 5) % 7)) // 7
```

Week 0 is the part of the year before the first Sunday (`%U`) or Monday (`%W`).

ISO weeks:

```text
iso_weekday = 7 if wday == 1, otherwise wday - 1
week = (yday - iso_weekday + 10) // 7
```

A year has 53 ISO weeks if 1 January is a Thursday, or a Wednesday in a leap
year; otherwise 52. If week is below 1, it is the last week of the previous year;
if it is above the number of weeks, it is week 1 of the next year. `%G` and `%g`
give the year of the ISO week.

#### Invalid conversions {#sec-bios-os-invalid-conversions-and-embedded-zero}

Another code raises `invalid conversion specifier '%<code>'`, with the modifier
if there is one:

| Format ends with | Message |
|---|---|
| `%` | `invalid conversion specifier '%'` |
| `%E` | `invalid conversion specifier '%E'` |
| `%O` | `invalid conversion specifier '%O'` |
| `%EO` | `invalid conversion specifier '%EO'` |

A zero character in the format is copied like any other.

### Padding {#sec-bios-os-numeric-text-and-padding-limits}

Padding is added in front of the whole text: −1 with Z(v, 4) gives `00-1`. The
width is a minimum.

### Globals used {#sec-bios-os-library-bindings-and-execution-cost}

`os.date` uses the current global `tostring` and `error`, and `sub` of the string
library installed by the BIOS. Its time depends on the format.
