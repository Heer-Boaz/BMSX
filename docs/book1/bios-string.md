# BIOS String library {#sec-bios-string}

The `string` table provides functions for building, slicing, formatting and
searching text, and for packing records into Strings. Every String also has
these functions as methods: `string.sub(text, 2, 4)` can be written
`text:sub(2, 4)`.

| Function | Purpose |
| --- | --- |
| `string.byte`, `string.char`, `string.len` | Byte values and length |
| `string.from_bytes` | Copy bytes from memory into a String |
| `string.upper`, `string.lower` | ASCII case |
| `string.sub`, `string.reverse`, `string.rep` | Slices and repetition |
| `string.format` | Formatted text |
| `string.find`, `string.match`, `string.gmatch`, `string.gsub` | Pattern search and substitution |
| `string.pack`, `string.packsize`, `string.unpack` | Binary records |

## Strings and text {#sec-bios-string-text-values-and-encoded-byte-storage}

A String is a sequence of bytes `00H`–`FFH` that cannot be changed. It may
contain NUL bytes and byte sequences that are not UTF-8. Lengths and positions
count bytes; position 1 is the first byte.

Text written in a program is stored as UTF-8: `'é'` and `'\xc3\xa9'` are the
same two bytes, `'\xe9'` is one byte with value 233. To build UTF-8 from
character codes at run time, use `utf8.char`, not `string.char`.

### Example {#sec-bios-string-example-codepoints-and-mapped-utf-8}

```lua
rodata greeting: u8[4] = { 0x41, 0xc3, 0xa9, 0 }
local text = string.from_bytes(greeting, #greeting)
local length = #text                             -- 4 bytes
local lead = string.byte(text, 2)                -- 195
local tail = string.byte(text, 3)                -- 169
local same = text == utf8.char(65, 233, 0)       -- true
local raw = string.char(0xff, 0, 0x80)           -- a String, not UTF-8
```

## Bytes and length {#sec-bios-string-codepoint-access-construction-length-and-utf-8-input}

### string.byte {#sec-bios-string-stringbytevalue-position}

```text
string.byte(s [, i]) -> byte value or nil
```

Returns the byte at position i (default 1), from 0 to 255; nil if i is outside
the String. Negative positions do not count from the end. Only one byte is
returned.

### string.char {#sec-bios-string-stringchar}

```text
string.char(...) -> String
```

Returns a String with one byte per argument, in order. Each argument must be a
number from 0 to 255. With no arguments: `""`.

### string.len {#sec-bios-string-stringlenvalue}

```text
string.len(s) -> number of bytes
```

The same as `#s`. NUL bytes are counted.

### string.from_bytes {#sec-bios-string-stringfrom_utf8address-byte_count}

```text
string.from_bytes(address, count) -> String
```

Copies count bytes from address into a new String. The range must lie wholly
in System ROM, main RAM available to the program, or the ROM or RAM of the
selected cartridge. I/O registers cannot be read this way. An invalid range
raises `Invalid argument.` before anything is read; count 0 gives `""`. The
copy is complete before the next instruction; later changes to the memory do
not affect the String.

#### UTF-8 {#sec-memory-text-codepoints-and-utf-8-bytes}

| Function | Result |
| --- | --- |
| `utf8.char(...)` | UTF-8 bytes for the character codes; surrogates and codes above the Unicode range are errors |
| `utf8.read(s, i, last)` | The character at byte position i (up to byte last) and the position of the next character |
| `utf8.count(s)` | The number of characters as read by `utf8.read` |

An invalid byte sequence reads as the replacement character U+FFFD and
advances one byte.

## Case, slices and repetition {#sec-bios-string-case-conversion-slicing-reversal-and-repetition}

| Function | Result |
| --- | --- |
| `string.upper(s)` | `a`–`z` changed to `A`–`Z` |
| `string.lower(s)` | `A`–`Z` changed to `a`–`z` |
| `string.sub(s, i [, j])` | Bytes i to j |
| `string.reverse(s)` | Bytes in reverse order |
| `string.rep(s, n [, sep])` | n copies, separated by sep |

### Case {#sec-bios-string-ascii-case-conversion}

Only the ASCII letters change; all other bytes are kept.

```lua
local text = 'Azé🚀'
local capitals = string.upper(text) -- 'AZé🚀'
local small = string.lower(text)    -- 'azé🚀'
```

### string.sub {#sec-bios-string-inclusive-slices}

Returns the bytes from i to j, both included. With L = `#s`, each bound is first
rounded down (`// 1`), then:

| Value | Start i | End j |
| --- | --- | --- |
| Positive | The value | The value |
| Negative | L + value + 1 | L + value + 1 |
| 0 or NaN | 1 | 0 |
| nil | 1 | L |

A start below 1 becomes 1; an end above L becomes L. If j < i, the result is
`""`. Pass nil explicitly for a default start: `string.sub(s, nil, 3)`. Note
that an end of 0 means 0 here, while in `table.concat` it means L.

```lua
local middle = string.sub('ABCDE', 2.9, 4.9) -- 'BCD'
local tail = string.sub('ABCDE', -2)         -- 'DE'
local empty = string.sub('ABCDE', 0, 0)      -- ''
```

### string.reverse {#sec-bios-string-codepoint-reversal}

```lua
local backwards = string.reverse('ABC') -- 'CBA'
```

Bytes are reversed, so reversed UTF-8 text is no longer valid UTF-8.

### string.rep {#sec-bios-string-repetition-and-separators}

n (default 1) is rounded down; for n ≤ 0 the result is `""`. sep, if not nil, is
placed between the copies.

```lua
local joined = string.rep('go', 3, '/') -- 'go/go/go'
local once = string.rep('go')           -- 'go'
local none = string.rep('go', 0, '/')   -- ''
```

### Results {#sec-bios-string-captured-calls-and-work-performed}

These functions return a new String; the input is not changed.

## string.format {#sec-bios-string-stringformat}

```text
string.format(format, ...) -> String
```

Returns the text of format, with each conversion (`%…`) replaced by the next
argument. Widths and precisions count bytes. Unused arguments are ignored.

### Example {#sec-bios-string-example-formatted-text}

```lua
local label = string.format('HP %d/%d', 7, 10)        -- 'HP 7/10'
local signed = string.format('%+06d', 42)             -- '+00042'
local hexadecimal = string.format('%#08x', 42)        -- '0x00002a'
local amount = string.format('%*.*f', 8, 2, 1.25)     -- '    1.25'
local left = string.format('%*s', -5, 'go')           -- 'go   '
local zeros = string.format('%.0d/%#.0o', 0, 0)       -- '/0'
local unsigned = string.format('%u', -1)              -- '4294967295'
local floating = string.format('%.2f/%.1e/%#.3g',
    1.25, 12.5, 100)                                  -- '1.25/1.3e+01/100.'
```

Floating conversions print the Float value: `string.format('%d/%.0f', 16777217,
16777217)` gives `'16777217/16777216'`.

### Conversions {#sec-bios-string-conversion-syntax-and-argument-order}

```text
%[flags][width][.precision][modifiers]conversion
```

| Part | Form |
| --- | --- |
| Flags | Any of `-`, `+`, space, `0`, `#` |
| Width | Digits or `*` |
| Precision | `.` followed by digits or `*`; `.` alone is 0 |
| Modifiers | `l`, `L`, `h`; ignored |
| Conversion | One of `s c d i u o x X f F e E g G q` |

`%%` gives `%`. Width and precision are at most 2147483647. A `*` takes the
next argument, a number, truncated towards 0: a negative width means
left-aligned, a negative precision means no precision. Arguments are taken in
order: width, precision, value. A missing argument is nil.

### Flags and padding {#sec-bios-string-flags-signs-and-padding}

Width is a minimum. The field is padded:

| Flag | Padding |
| --- | --- |
| None | Spaces before |
| `-` | Spaces after (overrides `0`) |
| `0` | Zeros after the sign and prefix |

| Flag | Effect |
| --- | --- |
| `+` | `+` before non-negative `d`, `i` and floating values |
| Space | A space before non-negative `d`, `i` and floating values (`+` overrides) |
| `#` | `0` prefix for `o`, `0x`/`0X` for non-zero `x`/`X`; a decimal point for floating values |

For integer conversions, a precision turns off the `0` flag. For `s`, `c` and
`q`, only width and `-` apply.

### Text conversions {#sec-bios-string-text-codepoint-and-quoted-conversions}

| Conversion | Output |
| --- | --- |
| `%s` | `tostring(value)`; a precision keeps at most that many bytes |
| `%c` | The byte with the integer part of value (0–255) |
| `%q` | `tostring(value)` in double quotes, with escapes |

`%q` escapes:

| Byte | Written as |
| --- | --- |
| 10, 13, 9 | `\n`, `\r`, `\t` |
| `\`, `"` | `\\`, `\"` |
| Other bytes below 32, and 127 | `\` and three decimal digits |

```lua
string.format('%c', 65.75)   -- 'A'
string.format('%3c', 65)     -- '  A'
```

### Integer conversions {#sec-bios-string-integer-conversions}

The value must be an Integer, or a Float whose integer part fits in 32 bits.

| Conversion | Output |
| --- | --- |
| `%d`, `%i` | Signed decimal |
| `%u` | Unsigned decimal |
| `%o` | Unsigned octal |
| `%x`, `%X` | Unsigned hexadecimal, lower or upper case |

Integer −1 prints as `4294967295`, `37777777777`, `ffffffff` or `FFFFFFFF`.
The precision is the minimum number of digits; precision 0 prints nothing for
the value 0 (`%#.0o` prints `0`).

### Floating conversions {#sec-bios-string-floating-conversions}

| Conversion | Output | Default precision |
| --- | --- | --- |
| `%f`, `%F` | Fixed point: `123.456000` | 6 digits after the point |
| `%e`, `%E` | Exponent: `1.234560e+02` | 6 digits after the point |
| `%g`, `%G` | `%e` if the exponent is below −4 or at least the precision, otherwise `%f`; trailing zeros removed (kept with `#`) | 6 significant digits (0 counts as 1) |

An Integer is first converted to a Float. Rounding is to nearest, halves away
from 0: `%.1f` of 1.25 is `1.3`. The exponent has a sign and at least two
digits. Infinity prints as `inf` (`INF`), NaN as `nan` (`NAN`). Precision 0
omits the decimal point unless `#` is given.

### Errors {#sec-bios-string-errors-completed-work-and-limits}

| Condition | Message |
| --- | --- |
| `%` at the end, or without a conversion | `string.format incomplete format specifier.` |
| Unknown conversion C | `string.format unsupported format specifier '%C'.` |

A wrong argument raises the error of the conversion. No partial result is
returned. Large widths and precisions need correspondingly long Strings.

## Patterns {#sec-bios-string-pattern-language}

Patterns match bytes. The character classes are ASCII classes.

### Example {#sec-bios-string-example-patterns-and-substitutions}

```lua
local name, x_text, y_text = string.match('ship_17 x=12 y=-3',
    '^(%w+)%s+x=(%-?%d+)%s+y=(%-?%d+)$')
local x, y = tonumber(x_text), tonumber(y_text)       -- 12, -3
local start, finish = string.find('a.b', '.', 1, true) -- 2, 2: a literal dot
local position, digits = string.match('tag=42', '()(%d+)') -- 5, '42'

for word in string.gmatch('cat dog ship_17', '%w+') do
    print(word)                                       -- cat, dog, ship_17
end
local text, count = string.gsub('red blue', '(%a+)', '[%1]')
-- text is '[red] [blue]'; count is 2
```

| Call | Results |
| --- | --- |
| `string.match('a1b2b', 'a.*b')` | `'a1b2b'` |
| `string.match('a1b2b', 'a.-b')` | `'a1b'` |
| `string.match('x(a(b)c)y', '%b()')` | `'(a(b)c)'` |
| `string.match('cat scatter', '%f[%w]cat%f[%W]')` | `'cat'` |
| `string.match('go go stop', '(%w+)%s+%1')` | `'go'` |
| `string.find('abc', '', 4)` | nil |
| `string.match('abc', '', 4)` | `''` |
| `string.gsub('red blue', '(%a+)', { red = false })` | `'false blue'`, 2 |
| `string.gsub('abc', '', '_')` | `'_a_b_c_'`, 4 |

A replacement function keeps the match by returning false or nil:

```lua
local changed, count = string.gsub('red blue', '(%a+)', function(word)
    if word == 'red' then
        return false
    end
    return 'B'
end)
-- changed is 'red B'; count is 2
```

### Characters and classes {#sec-bios-string-single-codepoint-atoms-and-escapes}

A character matches itself; `.` matches any byte; `%` followed by a
punctuation character matches that character (`%.` is a dot).

| Class | Bytes |
| --- | --- |
| `%a` | `A`–`Z`, `a`–`z` |
| `%c` | 0–31, 127 |
| `%d` | `0`–`9` |
| `%g` | 33–126 |
| `%l` | `a`–`z` |
| `%p` | 33–47, 58–64, 91–96, 123–126 |
| `%s` | Space, 9–13 |
| `%u` | `A`–`Z` |
| `%w` | Letters, digits and `_` |
| `%x` | `0`–`9`, `A`–`F`, `a`–`f` |
| `%z` | 0 |

An upper-case letter after `%` matches every byte that the lower-case letter
does not match: `%D` is a non-digit. There is no alternation (`|`) and no
counted repetition (`{n}`).

### Sets {#sec-bios-string-bracket-sets}

`[…]` matches one byte from the set; `[^…]` one byte not in it. A set may
contain characters, classes (`%a`) and ranges (`a-z`). Write `%]`, `%-` and
`%[` for these characters inside a set. A set without `]` raises
`invalid string pattern`.

### Anchors {#sec-bios-string-anchors-and-search-order}

`^` at the start of the pattern makes the match start at the starting
position; `$` at the end matches the end of the String. Elsewhere they are
ordinary characters. Without `^`, the search tries each start position from
left to right and takes the first match.

### Repetition {#sec-bios-string-greedy-and-minimal-repetition}

A character, class or set may be followed by:

| Suffix | Matches |
| --- | --- |
| `*` | 0 or more, as many as possible |
| `+` | 1 or more, as many as possible |
| `-` | 0 or more, as few as possible |
| `?` | 0 or 1 |

Captures, `%b`, `%f` and back-references cannot be repeated.

### Captures {#sec-bios-string-captures-and-backreferences}

`(…)` captures the text it matches; `()` captures the current position as a
number. Captures are numbered by their opening parenthesis. `%1`–`%9` match the
text of an earlier, closed capture again; `%10` is `%1` followed by `0`. A
reference to a missing or open capture, or to a position capture, raises
`invalid string pattern capture`.

### Balanced text {#sec-bios-string-balanced-regions}

`%bxy` matches text from x to the matching y, counting nested pairs: `%b()`
matches a parenthesised expression.

### Frontiers {#sec-bios-string-frontiers}

`%f[set]` matches the empty string at a position where the previous byte is
not in the set and the next byte is. The start and end of the String count as
byte 0.

### Errors {#sec-bios-string-reached-errors-and-incomplete-forms}

| Error | Message |
| --- | --- |
| Set without `]` | `invalid string pattern` |
| `%f` not followed by `[` | `invalid string pattern` |
| `)` without `(` | `invalid string pattern` |
| `%1`–`%9` without a closed text capture | `invalid string pattern capture` |

The pattern is checked as it is used; part of a pattern that is never reached
is not checked.

## Search and substitution {#sec-bios-string-pattern-searches-and-substitutions}

Searching takes time in proportion to the length of the text and the amount of
backtracking the pattern causes.

### string.find {#sec-bios-string-stringfind}

```text
string.find(s, pattern [, init [, plain]]) -> start, end, captures… | nil
```

Returns the position of the first match (first and last byte) and the
captures. init (default 1) is rounded down; a negative init counts from the
end, 0 is 1. If init > `#s`, the result is nil. With plain true, pattern is
searched as plain text.

### string.match {#sec-bios-string-stringmatch}

```text
string.match(s, pattern [, init]) -> captures… | match | nil
```

Returns the captures of the first match, or the whole match if the pattern has
no captures. init as for `find`, but a match at position `#s + 1` (an empty
match) is possible.

### string.gmatch {#sec-bios-string-stringgmatch}

```text
string.gmatch(s, pattern) -> iterator
```

Returns a function that finds the next match each time it is called and
returns its captures (or the whole match); nil when there are no more. After an
empty match the search continues one byte further.

### string.gsub {#sec-bios-string-stringgsub}

```text
string.gsub(s, pattern, replacement [, n]) -> String, count
```

Replaces each match, at most n times (default: all), and returns the new
String and the number of replacements.

| Replacement | Used as |
| --- | --- |
| String or number | Text; `%0` is the whole match, `%1`–`%9` the captures, `%%` a `%` |
| Table | `replacement[first capture]` |
| Function | `replacement(captures…)`, first result used |

Without captures, the whole match is the first capture. A Table or function
result of nil or false keeps the match unchanged (a Table value false is
written as `false`). Any other result is converted with `tostring`. Another
kind of replacement raises
`string.gsub replacement must be a string, number, function, or table.`

## Floating-point words {#sec-bios-string-floating-point-word-decoder}

The BIOS function `string/float/decode` converts the bits of a 4-byte or
8-byte IEEE 754 number to a Float:

```lua
local decode_float<const> = require('string/float/decode')
local sample = decode_float(0x3fa00000, 0, 4)       -- 1.25
local calibration = decode_float(0xc0040000, 0, 8)  -- -2.5
```

```text
decode_float(high, low, byte_count) -> Float
```

| Argument | 4 bytes | 8 bytes |
| --- | --- | --- |
| `high` | The 32-bit word | The high word (sign and exponent) |
| `low` | 0 | The low word |
| `byte_count` | 4 | 8 |

The calculation is given under [decoding](#sec-bios-string-decoding).

## Binary records {#sec-bios-string-string-packet-packing}

`string.pack` writes values into a String in a given binary format;
`string.unpack` reads them back.

```text
string.pack(format, v1, v2, …) -> String
string.packsize(format) -> number of bytes
string.unpack(format, s [, pos]) -> v1, v2, …, next position
```

`packsize` is for fixed-size formats only. `unpack` returns the values,
followed by the position after the last byte read.

```lua
local format = "<I2c4"
local packet = string.pack(format, 513, "BMSX")    -- bytes 1, 2, 66, 77, 83, 88
local size = string.packsize(format)               -- 6
local kind, tag, next_pos = string.unpack(format, packet) -- 513, 'BMSX', 7
```

### Bytes {#sec-bios-string-packet-units-are-string-codepoints}

Each byte of a record is one byte of the String. Text is copied unchanged.

### Example {#sec-bios-string-example-a-packed-record}

A header, a text with a length byte and a text ended by a zero byte:

```lua
local header_format = '< !4 B H > h < f d c3'
local payload = 'A' .. string.char(0) .. 'B'
local record = string.pack(header_format .. ' s1 z',
    1, 4660, -300, 1.25, -2.5, 'POSITION', payload, 'ready')
local header_size = string.packsize(header_format)  -- 23
local record_length = #record                       -- 33
local version, flags, delta, sample, calibration, tag, next_pos =
    string.unpack(header_format, record)
-- 1, 4660, -300, 1.25, -2.5, 'POS', 24
local decoded_payload, status, after_record =
    string.unpack('s1 z', record, next_pos)
-- 'A\0B', 'ready', 34
```

| Offset | Field | Bytes |
| --- | --- | --- |
| 0 | `B` version | 1 |
| 1 | Padding | 0 |
| 2–3 | `H` flags, little-endian | 52, 18 |
| 4–5 | `h` delta, big-endian | 254, 212 |
| 6–7 | Padding | 0, 0 |
| 8–11 | `f` sample | 0, 0, 160, 63 |
| 12–19 | `d` calibration (aligned to 4) | 0, 0, 0, 0, 0, 0, 4, 192 |
| 20–22 | `c3` tag | 80, 79, 83 |
| 23 | `s1` length | 3 |
| 24–26 | Payload | 65, 0, 66 |
| 27–32 | `z` status | 114, 101, 97, 100, 121, 0 |

The zero byte in the payload is allowed in `s1`; in `z` it would be an error.

### Formats {#sec-bios-string-formats}

A format is a sequence of options; spaces are ignored. Each call starts
little-endian, with maximum alignment 8. A = the current maximum alignment.

| Option | Field | Bytes | Alignment |
| --- | --- | ---: | --- |
| `b`, `B` | Signed, unsigned integer | 1 | 1 |
| `h`, `H` | Signed, unsigned integer | 2 | min(A, 2) |
| `l`, `L`, `j`, `J` | Signed, unsigned integer | 4 | min(A, 4) |
| `i[n]`, `I[n]` | Signed, unsigned integer | n (1–8), default 4 | min(A, n) |
| `T` | Unsigned integer | 4 | 4 |
| `f`, `n` | Float | 4 | min(A, 4) |
| `d` | Double | 8 | min(A, 8) |
| `cn` | Text of exactly n bytes | n | 1 |
| `z` | Text ended by a zero byte | Length + 1 | 1 |
| `s[n]` | Text after an n-byte length (1–8, default 4) | n + length | min(A, n) |
| `x` | One zero byte | 1 | 1 |
| `X` | Padding to the alignment of the next option | — | — |

| Control | Effect |
| --- | --- |
| `<` | Little-endian |
| `>` | Big-endian |
| `=` | Little-endian |
| `!n` | Maximum alignment n (required, at least 1) |

Each field takes one argument in `pack` and gives one value in `unpack`.
Controls, `x` and `X` take none. Numbers in a format are at most 2147483647.

#### Alignment {#sec-bios-string-alignment-and-padding}

Before a field with alignment a > 1, zero bytes are added until the offset is a
multiple of a:

```text
padding = (a - offset % a) % a
```

`unpack` skips padding without checking it, and counts offsets from the start
of the String, not from pos. `X` uses the alignment of the next field; for `cn`
that is n. No padding is added at the end of a record.

`string.packsize("!1bT")` is 8; `string.packsize("bXc3")` is 6.

### Integers {#sec-bios-string-integer-fields}

The value must be an integer. Fields narrower than 4 bytes must hold it: −128
to 127 for `b`, 0 to 255 for `B`, and so on. Fields of 4 bytes take any 32-bit
value; wider fields extend it with its sign (signed) or zeros (unsigned).

`string.pack("<I4", -1)` gives four bytes 255; `string.pack("<I2", -1)` is an
error. An unpacked value must fit in 32 bits: four bytes 255 give −1 for both
`j` and `J`; eight bytes 255 give −1 for `i8` and an error for `I8`.

### Text {#sec-bios-string-text-fields}

#### cn {#sec-bios-string-cn-fixed-width}

`pack` writes the first n bytes, filling with zero bytes if the text is
shorter. `unpack` returns n bytes. `c0` takes an argument and writes nothing.

#### z {#sec-bios-string-z-zero-terminated}

`pack` writes the text and a zero byte; the text must not contain a zero byte.
`unpack` reads up to the first zero byte.

#### s[n] {#sec-bios-string-sn-length-prefixed}

`pack` writes the length as an unsigned n-byte integer, then the text. The text
may contain zero bytes. `packsize` cannot be used with `z` or `s`.

### Floating-point numbers {#sec-bios-string-floating-point-fields}

`f` and `n` are IEEE 754 single precision (4 bytes), `d` double precision
(8 bytes).

#### Encoding {#sec-bios-string-encoding}

An Integer is rounded to the nearest Float (halves to even) for `f`; `d`
holds the exact value. Signed zeros, infinities and small (subnormal) values
are kept. A NaN keeps its bits in `f` and becomes `7FF80000 00000000H` in `d`.

| Value | `f` | `d` (high, low) |
| --- | --- | --- |
| 0 | `00000000H` | `00000000H`, `00000000H` |
| −0.0 | `80000000H` | `80000000H`, `00000000H` |
| 1.25 | `3FA00000H` | `3FF40000H`, `00000000H` |
| 2^−149^ | `00000001H` | `36A00000H`, `00000000H` |
| +infinity | `7F800000H` | `7FF00000H`, `00000000H` |
| NaN | `7FC00000H` | `7FF80000H`, `00000000H` |

A little-endian `d` writes the low word first; a big-endian `d` the high word
first. Each word is written in the byte order selected.

| Field | Exponent bits E | Fraction bits M | Bias B | S |
| --- | ---: | ---: | ---: | ---: |
| `f`, `n` | 8 | 23 | 127 | 2^23^ |
| `d` | 11 | 52 | 1023 | 2^52^ |

#### Decoding {#sec-bios-string-decoding}

The result is a Float; a `d` value is rounded to single precision (halves to
even), and a `d` NaN becomes `7FC00000H`. With sign = −1 if bit 31 of high is
set, otherwise 1:

```text
f, n:  e = (high >> 23) AND FFH     m = high AND 7FFFFFH
d:     e = (high >> 20) AND 7FFH    m = (high AND FFFFFH) × 2^32 + low

e = 2^E - 1, m = 0:   sign × infinity
e = 2^E - 1, m ≠ 0:   NaN
e = 0:                sign × (m / S) × 2^(1 - B)
otherwise:            sign × (1 + m / S) × 2^(e - B)
```

### Reading position {#sec-bios-string-unpack-positions-bounds-and-results}

pos (default 1) is rounded down and must lie from 1 to `#s + 1`; negative
values do not count from the end. Remaining bytes after the last field are
allowed. Use the returned position to continue:

```lua
local first, next_pos = string.unpack("<I2", packet)
local tag, after_tag = string.unpack("c4", packet, next_pos)
```

Alignment is still counted from the start of the String.

### Arguments {#sec-bios-string-argument-categories-and-library-dependencies}

Formats, text fields and records are Strings; number fields take numbers.

### Errors {#sec-bios-string-errors}

| Condition | Message |
| --- | --- |
| Integer field value not an integer | `string.pack integer value must be an integer.` |
| Integer value too large for its field | `string.pack integer value out of range.` |
| Unpacked integer outside 32 bits | `string.unpack integer exceeds safe integer range.` |
| Number in the format too large | `string.pack format count out of range.` |
| packsize result above 2147483647 | `string.packsize size out of range.` |
| Float field value not a number | `string.pack float value must be a number.` |
| `!` without a positive number | `string.pack alignment must be a positive integer.` |
| `i`/`I` size outside 1–8 | `string.pack invalid integer size.` |
| `c` without a size | `string.pack expected a size for c format.` |
| `s` size outside 1–8 | `string.pack invalid length size.` |
| Unknown option | `string.pack unsupported format option.` |
| Zero byte in a `z` text | `string.pack z strings must not contain zero bytes.` |
| `z` or `s` in packsize | `string.packsize format is variable-length.` |
| pos outside the String | `string.unpack start index out of range.` |
| String ends inside a field | `string.unpack string is too short.` |
| No zero byte for `z` | `string.unpack zero-terminated string not found.` |

## Execution time {#sec-bios-string-work-and-interface-boundaries}

Added to the time of the call:

| Function | Cycles |
| --- | --- |
| `string.char` | 1 per argument |
| `string.from_bytes` | 2 + 1 per byte |
| `string.sub` | 1 per byte copied (0 for the whole String or `""`) |

The time of the other functions depends on the length of the text, the
pattern and the format.
