# BMSX BIOS `os.date` bounded source facts

Scope: facts extracted from current owners, not proposed chapter prose. No repository edits, builds, tests, emulator runs, architecture document, historical PDF, or external-library assumptions used. Numeric civil algorithms below are reported as the authored algorithms, not an all-state arithmetic/optimizer parity proof.

## Entry, result kinds, and selection order

- Exact authored entry is `os.date = function(format, timestamp)`; it returns one newly created date table for the exact post-prefix format `'*t'`, otherwise one formatted string. It has no explicit additional-argument processing. [`machine/bios/os.lua:308-319`]
- Missing function parameters are filled with guest nil on the ordinary call path. [`machine/ts/machine/cpu/cpu.ts:3280-3288`; `machine/cpp/machine/cpu/cpu.cpp:3027-3035`]
- Only `format == nil` selects `'%c'`; false does not select the default. Only `timestamp == nil` selects `*time_ms // 1000`; false does not select the default. In these two `and/or` expressions the selected default format is nonempty text and the selected time is numeric, not false/nil. [`machine/bios/os.lua:308-313`]
- `time_ms` is the local typed `*word` address `0x08010228`. The default timestamp expression reads it in the call, divides by `1000` using `//`, and does not pass that result through `require_time_value`. No live clock/timezone semantics are inferred here from the register's name. [`machine/bios/os.lua:8`; `machine/bios/os.lua:313`]
- Prefix handling: call `string.sub(bmsx_format,1,1)` first; if its result is `'!'`, replace the format with `string.sub(bmsx_format,2)`. This removes at most one leading exclamation mark. There is no retained flag and no different calendar/timezone path after it. Thus `!*t` selects the table branch; `!!*t` does not. [`machine/bios/os.lua:309-318`]
- Operational order: choose format -> inspect/remove one leading `!` -> choose/validate timestamp -> test exact `*t` -> decompose timestamp -> scan format. Even an empty formatted-string result requires the timestamp-selection/validation step first; an invalid conversion is not examined until after timestamp validation and calendar decomposition. [`machine/bios/os.lua:308-319`; `machine/bios/os.lua:178-205`]
- A false format reaches `string.sub` before timestamp processing, not a BIOS date-specific argument validator. The shipped `sub` first evaluates `#value`; CPU LEN accepts String/Table and otherwise throws `LUA_FAULT_REASON_UNKNOWN`. A false timestamp reaches retained `modf`, not the missing-timestamp path; the precise lower comparison/arithmetic fault diagnostic is outside this packet. [`machine/bios/os.lua:309-313`; `machine/bios/string/base.lua:58-61`; `machine/ts/machine/cpu/cpu.ts:2672-2684`; `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330`; `machine/bios/math.lua:27-31,59-61`]

## Timestamp validation and authored errors

- Explicit timestamp is passed through `require_time_value`: call local `require_integer(value,'time is not an integer')`; that calls captured `modf(value)`, retains its first result, and invokes global `error(message)` when the retained result differs from the input. Only then check inclusive bounds `-0x1fffffffffffff` through `0x1fffffffffffff`; outside produces `error('time is out-of-bound')`. It returns the retained integer. These are exact authored message strings, not guaranteed host presentation with prefixes/tracebacks. [`machine/bios/os.lua:13-14,24-30,55-61`]
- Captured BIOS `math.modf` calls local `trunc`: negative value -> `-((-value)//1)`, otherwise `value//1`; returns `integer, value-integer`. The date integer test does not call a host numeric parser, and date has no explicit type-dispatch/coercion layer. [`machine/bios/math.lua:27-31,59-62`; `machine/bios/os.lua:6,24-30`]

## Calendar decomposition and table output

- Day length constant is `86400`. Decomposition: `days = timestamp // 86400`; `seconds_of_day = timestamp - days*86400`; obtain civil year/month/day using `civil_from_days(days)`; `hour = seconds_of_day//3600`; `min = (seconds_of_day-hour*3600)//60`; `sec = seconds_of_day-hour*3600-min*60`; `yday = days-days_from_civil(year,1,1)+1`; `wday = ((days+4)%7)+1`. [`machine/bios/os.lua:10,91-100`]
- Civil inverse algorithm, exactly as sourced: add `719468` to days; `era=days//146097`; `doe=days-era*146097`; `yoe=(doe-doe//1460+doe//36524-doe//146096)//365`; `year=yoe+era*400`; `doy=doe-(365*yoe+yoe//4-yoe//100)`; `mp=(5*doy+2)//153`; `day=doy-(153*mp+2)//5+1`; `month=mp+(mp<10 and 3 or -9)`; increment year if month<=2. [`machine/bios/os.lua:75-89`]
- Forward civil algorithm used for year starts/weeks: decrement year if month<=2; `era=year//400`; `yoe=year-era*400`; `mp=month+(month>2 and -3 or 9)`; `doy=(153*mp+2)//5+day-1`; `doe=yoe*365+yoe//4-yoe//100+doy`; return `era*146097+doe-719468`. These are the file's 400-year/century/four-year calendar rules; no libc calendar call appears. [`machine/bios/os.lua:63-73`]
- The `*t` path creates `{}` and writes exactly `year`, `month`, `day`, `hour`, `min`, `sec`, `wday`, `yday` from decomposition plus `isdst=false`; returns that same newly created table. Sunday is index 1 because `wday` indexes the fixed Sunday-first weekday arrays. It does not consume a caller-supplied date table. [`machine/bios/os.lua:15-16,102-114,314-315`]

## Format grammar

- Scan begins at codepoint index 1 and continues while `index <= #format`. Every non-`%` character is appended literally. A `%` consumes the following one-character code, optionally first consuming exactly one `E` or `O` modifier and then one code. No flags, width syntax, precision syntax, repeated modifiers, or alternative escape introducer are implemented. Unsupported codes reach the error branch; all accepted plain codes are listed below. [`machine/bios/os.lua:19-22,178-205,206-285`]
- `E` accepts exactly `c C x X y Y`. `O` accepts exactly `d e H I m M S u U V w W y`. The modifier is checked before main conversion dispatch, then main dispatch uses the code alone; accepted modified conversions therefore use exactly the unmodified output path, not alternate locale/era/digits. [`machine/bios/os.lua:19-21,167-172,193-206`]
- Invalid conversion calls global `error("invalid conversion specifier '%" .. modifier .. code .. "'")`. With shipped `sub`, absent code reads as `''`: trailing `%` produces authored text `invalid conversion specifier '%'`; trailing `%E`/`%O` produces `invalid conversion specifier '%E'` / `invalid conversion specifier '%O'`. `%EO` fails modifier validation as `%EO`; the second modifier is not separately parsed. [`machine/bios/os.lua:174-176,189-205,278-282`; `machine/bios/string/base.lua:58-75`]

### Accepted plain conversions

Notation: `Z(value,n)` means the file's zero-prepend loop to minimum total text length n; `S(value,n)` is its space-prepend loop. These are descriptive notation, not additional APIs. Neither truncates. [`machine/bios/os.lua:124-138`]

| Code | Exact output construction | Owner |
|---|---|---|
| `%C` | `Z(year//100,2)` | `machine/bios/os.lua:206-207` |
| `%D`, `%x` | `Z(month,2)/Z(day,2)/Z(year%100,2)` with literal slashes | `machine/bios/os.lua:208-209,270-271` |
| `%F` | `Z(year,4)-Z(month,2)-Z(day,2)` with literal hyphens | `machine/bios/os.lua:210-211` |
| `%G` | `Z(iso_year,4)` | `machine/bios/os.lua:203-205,212-213` |
| `%g` | `Z(iso_year%100,2)` | `machine/bios/os.lua:203-205,214-215` |
| `%Y` | `Z(year,4)` | `machine/bios/os.lua:216-217` |
| `%y` | `Z(year%100,2)` | `machine/bios/os.lua:218-219` |
| `%m` | `Z(month,2)` | `machine/bios/os.lua:220-221` |
| `%d` | `Z(day,2)` | `machine/bios/os.lua:222-223` |
| `%e` | `S(day,2)` | `machine/bios/os.lua:224-225` |
| `%H` | `Z(hour,2)` | `machine/bios/os.lua:226-227` |
| `%M` | `Z(min,2)` | `machine/bios/os.lua:228-229` |
| `%S` | `Z(sec,2)` | `machine/bios/os.lua:230-231` |
| `%I` | `Z(hour12,2)`; hour12 is 12 if `hour%12==0`, otherwise `hour%12` | `machine/bios/os.lua:180,232-233` |
| `%R` | `Z(hour,2):Z(min,2)` | `machine/bios/os.lua:234-235` |
| `%r` | `Z(hour12,2):Z(min,2):Z(sec,2) AMPM` | `machine/bios/os.lua:236-237` |
| `%T`, `%X` | `Z(hour,2):Z(min,2):Z(sec,2)` | `machine/bios/os.lua:238-239,272-273` |
| `%p` | `AM` when hour<12, otherwise `PM` | `machine/bios/os.lua:181,240-241` |
| `%a` | fixed short weekday name indexed by wday | `machine/bios/os.lua:15,242-243` |
| `%A` | fixed long weekday name indexed by wday | `machine/bios/os.lua:16,244-245` |
| `%h`, `%b` | fixed short month name indexed by month | `machine/bios/os.lua:17,246-249` |
| `%B` | fixed long month name indexed by month | `machine/bios/os.lua:18,250-251` |
| `%j` | `Z(yday,3)` | `machine/bios/os.lua:252-253` |
| `%n` | literal newline `\n` | `machine/bios/os.lua:254-255` |
| `%t` | literal tab `\t` | `machine/bios/os.lua:256-257` |
| `%U` | `Z(sunday_week_number,2)` | `machine/bios/os.lua:258-259` |
| `%u` | `tostring(wday==1 and 7 or wday-1)`, no padding | `machine/bios/os.lua:260-261` |
| `%V` | `Z(iso_week_number,2)` | `machine/bios/os.lua:203-205,262-263` |
| `%w` | `tostring(wday-1)`, no padding | `machine/bios/os.lua:179,264-265` |
| `%W` | `Z(monday_week_number,2)` | `machine/bios/os.lua:266-267` |
| `%c` | `shortWeekday shortMonth Z(day,2) Z(hour,2):Z(min,2):Z(sec,2) Z(year,4)`; spaces exactly as shown, **zero-padded day**, not `%e` | `machine/bios/os.lua:268-269` |
| `%z` | literal `+0000` | `machine/bios/os.lua:274-275` |
| `%Z` | literal `BMSX` | `machine/bios/os.lua:276-277` |
| `%%` | literal `%` | `machine/bios/os.lua:278-279` |

- Short weekday names in order: `Sun Mon Tue Wed Thu Fri Sat`; long: `Sunday Monday Tuesday Wednesday Thursday Friday Saturday`. Short months: `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec`; long: `January February March April May June July August September October November December`. These are local fixed arrays, not locale lookup results. [`machine/bios/os.lua:15-18`]

## Week rules

- Sunday week helper: `(yday-1+7-(wday-1))//7`. Monday helper: `(yday-1+7-((wday+5)%7))//7`. The expressions yield week 0 before the first named weekday and week 1 starting on that weekday for the decomposed civil date; no ISO-year adjustment occurs in these helpers. [`machine/bios/os.lua:140-146`]
- ISO weekday remap is Sunday->7, otherwise `wday-1`. Candidate ISO week is `(yday-iso_weekday+10)//7`. If candidate<1, decrement ISO year and take that year's week count; otherwise if candidate exceeds that year's count, increment ISO year and set week=1. [`machine/bios/os.lua:153-165`]
- ISO year week count: `jan1_weekday=((days_from_civil(year,1,1)+3)%7)+1`; 53 exactly if Jan 1 weekday==4 or (weekday==3 and `days_from_civil(year+1,1,1)-days_from_civil(year,1,1)==366`), otherwise 52. [`machine/bios/os.lua:148-151`]
- ISO pair calculation happens separately when each encountered code is `G`, `g`, or `V` (including accepted `OV`); there is no per-date memoized pair in this formatter. [`machine/bios/os.lua:22,201-205`]

## String/codepoint and numeric-text limits

- Shipped `string` module uses the table returned from `require('string/base')`; it does not replace base `sub`. The base captures `__bmsx_string_byte` and `__bmsx_string_char` and publishes them as byte/char. [`machine/bios/string.lua:1-22`; `machine/bios/string/base.lua:1-5,39-40`]
- `sub(value,start,end)` operates using `#value`; clamps relevant bounds; returns `''` when end<start; returns original value for full-range slice; single-character slice is `char(byte(value,start))`; longer slice loops over indexes and concatenates those chars. Date uses positive integer indexes, including an index just past the end when a conversion is unfinished. [`machine/bios/string/base.lua:27-36,58-82`; `machine/bios/os.lua:185-196,310-311`]
- Runtime String LEN is cached codepoint count. TS count traverses `for...of`; native count advances UTF-8 codepoint indexes. Byte builtin is indexed by codepoint position (TS `for...of`/`codePointAt`; native UTF-8 iteration), not byte position. Consequently format scan units are codepoints, including non-ASCII literals; not UTF-8 byte offsets. This statement is about representable string codepoints, not malformed host-string parity. [`machine/ts/machine/cpu/cpu.ts:2672-2678,4320-4350`; `machine/cpp/machine/cpu/cpu_dispatch.inl:319-324`; `machine/cpp/machine/cpu/cpu.cpp:2176-2207`; `machine/ts/machine/cpu/string_pool.ts:124-126`; `machine/cpp/machine/cpu/string_pool.cpp:138-143`; `machine/ts/common/utf8.ts:1-7`; `machine/cpp/common/utf8.h:27-53`]
- Zero is not a terminator in these paths: byte scan traverses stored string length, char permits codepoint 0, native UTF-8 read returns ASCII byte 0 and append pushes byte 0. Thus a literal embedded zero is copied and scan continues; zero used as a conversion code is unsupported, with the code itself included in the assembled invalid-conversion message. [`machine/bios/os.lua:184-198,280-285`; `machine/ts/machine/cpu/cpu.ts:4342-4367`; `machine/cpp/machine/cpu/cpu.cpp:2196-2222`; `machine/cpp/common/utf8.h:55-60,98-101`]
- Pad helpers call **global `tostring` at formatting time**, then prepend zeros/spaces until `#text >= size`; no truncation, maximum width, sign-aware placement, decimal-only conversion, or date-specific large-year conversion exists. A leading minus is part of the complete text before zero-prepending (e.g. the algorithm for value -1,width 4 is `00-1`, not `-001`). [`machine/bios/os.lua:124-138`]
- Shipped global `tostring(value)` is `'' .. value`; concat routes Number through shared `formatNumber`, String through stored text. TS CONCAT/CONCATN and native CONCAT/CONCATN use the corresponding value-text routines. [`machine/bios/base.lua:235-237`; `machine/ts/machine/cpu/cpu.ts:2630-2656`; `machine/ts/machine/cpu/value.ts:190-198`; `machine/cpp/machine/cpu/cpu_dispatch.inl:271-305`; `machine/cpp/machine/cpu/value.cpp:24-29`]
- Shared number formatting uses precision 6: zero has a signed-zero branch; integral magnitudes strictly below 1,000,000 use complete ordinary decimal integer text. Otherwise normalize to decimal exponent, round six significand digits with ties-to-even, choose fixed form for adjusted exponent >=-4 and <6, otherwise scientific form with lowercase `e`, explicit exponent sign and at least two exponent digits; trailing fraction zeros/dot are trimmed. Date pads that resulting text unchanged. Therefore `%Y`/`%G`/`%C` output must not be promised to contain the complete exact decimal integer for arbitrarily large decomposed years; a minimum padding width is not a fixed four/two digit guarantee. [`machine/ts/common/number_format.ts:10,15-25,66-142`; `machine/cpp/common/number_format.h:10-25,64-171`; `machine/bios/os.lua:124-138,206-219`]

## Retained/live dependencies; work boundaries

- At module execution, os binds const locals to the required String and Math tables and to `math.modf`. The Math-table local is only read during initialization; later closures retain/use the modf function, not a later Math-table lookup. Later calls use that retained modf, but perform `string.sub` field accesses against the retained String table on each use; replacing a global `string` or another module table binding does not change that local reference, whereas changing its `sub` field changes the looked-up function. Global `tostring` and `error` were not locally captured by os. [`machine/bios/os.lua:4-6,24-30,55-61,124-138,174-176,185-196,261,265,310-311`]
- `*t` does one decomposition and table writes, bypasses scanning, name output, week formatting, and padding; ordinary string formatting does one initial decomposition, then a loop with growing string concatenation. Calendar decomposition/forward helpers have arithmetic and conditionals, not a year-by-year/day-by-day traversal. [`machine/bios/os.lua:63-114,178-287,314-318`]
- Main scanner increments by one codepoint for a literal, two for plain conversion, three for modified conversion; default `!` stripping may additionally reconstruct a tail slice. Padding loops prepend one char per iteration until minimum length. The shipped byte builtin scans from the beginning to requested codepoint for every call, so one-character `sub` calls do not establish constant-time random access; no linear-time/allocation-free guarantee is claimed. Longer prefix-stripping slices build a temporary char table and concat it. [`machine/bios/os.lua:124-138,184-205,283-285,310-311`; `machine/bios/string/base.lua:58-82`; `machine/ts/machine/cpu/cpu.ts:4342-4350`; `machine/cpp/machine/cpu/cpu.cpp:2196-2206`]

## Deliberate limits / unresolved boundaries

- No disagreement found in the directly checked owner slices. This is not a complete runtime/compiler/parity audit.
- This packet does not identify host wall-clock provenance, reset origin, wrap policy, timezone/UTC meaning of the register, real DST, locale compatibility, exact large-range arithmetic accuracy, all-state termination, heap/length limits, or host-rendered exception decorations. `!`, `+0000`, `BMSX`, and `isdst=false` are exactly the authored operations/literals above, not evidence for additional time-service promises.
- Exact non-number timestamp and non-string/non-false format runtime diagnostics beyond the listed owner control flow were not exhaustively traced. Date's own authored integer/bounds/conversion messages are listed; no Lua/libc-standard diagnostic is assumed.


## Independent source qualification after authorship

The independent paired-owner recheck derives the false-timestamp rejection:
false is not less than Number0, so retained modf chooses `false//1`; the numeric
read supplies NaN, which differs from false. `require_integer` therefore calls
the normally installed public error with exactly `time is not an integer`,
before time bounds. This is source deduction, not new executed observation.
Sources: `machine/bios/os.lua:24–30,55–61,313`;
`machine/ts/machine/cpu/cpu.ts:2701–2735,3569–3578,3589–3596`;
`machine/ts/machine/cpu/value_slots.ts:128–130`;
`machine/cpp/machine/cpu/cpu_dispatch.inl:341–349,356–368`;
`machine/cpp/machine/cpu/value.h:125–144`.
