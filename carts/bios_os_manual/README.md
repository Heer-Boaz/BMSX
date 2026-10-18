# BIOS time and calendar ordinary cartridge

This complete BLua program calls the installed `os.clock`, `os.time`,
`os.date` and `os.difftime`. It neither replaces the BIOS nor supplies a local
calendar/time encoder. See the [BIOS OS chapter](../../docs/book1/bios-os.md).

```text
carts/bios_os_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
tests/carts/bios_os_manual/
  bios_os_manual_assert.lua
  ordinary_timeline.json
```

The complete manifest is:

```yaml
title: BIOS OS Manual
hardware:
    - type: rom
```

`results.lua` owns numeric typed BSS and exports its linked address. Its
ordinary module also retains an observations Table: dynamic text, date Tables
and protected-call results remain guest values rather than fake byte-memory
encodings. `entry.lua` declares `module<entry>`, records and prints observations,
sets `completed`, then parks. All assertions belong to the separate test suite.
Do not mark `results.lua` as `module<const>`: its observations Table is mutable,
not a compile-time constant export.

## Build and inspect

From the repository root with the development prerequisites in
[getting started](../../docs/programming/getting-started.md):

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_os_manual --debug
npm run headless:test -- bios_os_manual tests/carts/bios_os_manual/bios_os_manual_assert.lua
```

Expect `[test] time_and_calendar_observations: passed`. The single case waits
for completion and makes 74 retained assertions. It uses a fresh derived TS
integration image, not byte-identical ordinary playback; linked addresses may
differ. The cart builder selects its matching BIOS. Normal compiler and quality
checks remain enabled.

Run the ordinary cartridge separately:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_os_manual/ordinary_timeline.json bios_os_manual
```

The timeline's zero-based presentation offset 4 is an endpoint, not an output
assertion or startup/frame/cycle guarantee. Successful ordinary playback must
print all 26 `OS ...` diagnostics below and complete the timeline. The newline
from `%n` makes `C` a separate continuation line. `print` separates arguments
with tabs and rounds Number text; the retained timestamp check is exactly
`1709168523`, not the displayed `1.70917e+09`.

## Ordinary observations

The block below records the checked ordinary run. Its first two lines are
sampled observations, not constant expected values. Every clock/default-time
call samples separately. The suite does not pin these
readings or the sampled date strings. They provide no real-time, RTC, UTC,
local-time, timezone-service, CPU-accounting or reset-origin guarantee.

```text
OS samples	1.036	1	1
OS sampled dates	Thu Jan 01 00:00:01 1970	1970-01-01 00:00:01
OS noon	43200	1970	1	1	12	0	0	5	1	false	kept
OS normalized	1.70917e+09	2024	2	29	1	2	3	5	60	false
OS epoch fields	1970	1	1	0	0	0	5	1	false
OS negative fields	1969	12	31	23	59	59	4	365	false
OS calendar	2021 21 20 | 01 01  1 001
OS names	Fri Friday | Jan January Jan
OS clock fields	13:02:03 | 01 PM | 13:02 | 01:02:03 PM | 13:02:03 | 13:02:03
OS composites	2021-01-01 | 01/01/21 | 01/01/21 | Fri Jan 01 13:02:03 2021
OS weeks	2021 | 2020 20-W53 | 00 00 | 5 5
OS next ISO year	2018-12-31 2019-W01-1
OS zone literals	offset +0000 zone BMSX %
OS separators	A	B
C
OS default format	Thu Jan 01 00:00:00 1970
OS E modifiers	Fri Jan 01 13:02:03 2021 | 20 01/01/21 13:02:03 21 2021
OS O modifiers	01  1 13 01 01 02 03 | 5 00 53 5 00 21
OS missing field	false	field 'year' missing in date table
OS fractional field	false	field 'hour' is not an integer
OS civil range	false	field 'year' is out-of-bound
OS timestamp range	false	time is out-of-bound
OS invalid conversion	false	invalid conversion specifier '%Q'
OS invalid modifier	false	invalid conversion specifier '%Ea'
OS differences	90	-1	9.0072e+15	inf	nan
OS fractional t2	false	os.difftime t2 must be an integer.
OS fractional t1	false	os.difftime t1 must be an integer.
```

Missing `hour` in the date Table means 12, unlike the omitted/nil date-Table
argument to `os.time`, which samples the counter. The `hour = 25` conversion
normalizes the same caller Table to the following leap day. `os.date('*t', -1)`
shows floor-day decomposition before timestamp zero. The extra `note` survives,
while input `wday`, `yday` and `isdst` are replaced by the computed fields.

The fixed formatting cases cover English names, numeric/composite dates and
clocks, both ISO-year crossover directions, Sunday/Monday week zero, literals
`+0000`/`BMSX`, whitespace, and accepted `E`/`O` modifiers. Those literals are not
evidence for host timezone or locale conversion. Leading-`!` and Table-valued
formats are deliberately not exercised by this program; it does not establish
the separate general Table-length/string-slicing boundary.

The protected calls retain the exact BIOS-authored messages. `difftime` accepts
the integral `9007199254740992` even though `date` rejects that timestamp: it has
no corresponding safe-range bound. Infinities pass its integer-equality tests;
the two demonstrated subtractions produce infinity and NaN, not a finite-only
API or counter-wrap repair.

These are finite TS build, retained-value and independent ordinary-execution
results, not native parity, all-input/optimizer/calendar-accuracy, performance,
reset/persistence, runtime-parser, SDK or whole-console acceptance. CPU7, Table
length, BZ01 and LS01 remain open.
