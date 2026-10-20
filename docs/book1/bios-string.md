# BIOS String operations {#sec-bios-string}

Use `string` for text construction, character access, slicing, formatting,
pattern matching and formatted String records. Normal BIOS startup installs
the Table and registers it for String method lookup. Call `string.sub(text,
start, finish)` or the corresponding `text:sub(start, finish)` form.

## Text values and encoded byte storage {#sec-bios-string-text-values-and-encoded-byte-storage}

String positions begin at 1 and count Unicode codepoints. `string.byte`
selects one complete codepoint; `string.char` constructs a String from numeric
codepoints. A String's language value is separate from an encoded byte range
in ROM or RAM.

Use `string.from_utf8(address, byte_count)` to construct text from mapped
UTF-8 bytes. The address selects actual byte storage and the count measures
encoded bytes. [BLua storage declarations](blua-programs.md#sec-blua-programs-typed-storage-layouts-and-address-views)
define those ranges; [[Memory](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, “Memory and bus access”]{.content-visible when-format="pdf"} gives their physical mapping and
reservations. [CPU value rules](cpu.md#sec-cpu) specify indexing and Number
conversion, and [protected calls](coroutines.md#sec-coroutines) describe language-error
handling.

The following example contains four codepoints. String positions start
at one; the mapped byte offsets start at zero. The last two codepoints each
occupy more than one encoded byte.

| String position | Codepoint | Byte offsets in the example | Encoded bytes |
| --- | --- | --- | --- |
| `1` | `41H` | `0` | `41H` |
| `2` | `7AH` | `1` | `7AH` |
| `3` | `E9H` | `2–3` | `C3H A9H` |
| `4` | `1F680H` | `4–7` | `F0H 9FH 9AH 80H` |

Thus eight encoded bytes and four String codepoints describe the same example
content. A zero codepoint is also content, not a terminator. Codepoint
operations do not imply that every text display can draw every codepoint.

Public library fields are mutable. String method lookup continues to use
the installed String-index Table after the global `string` name is rebound.
For character selection, use `string.byte` or a substring operation rather
than numeric Table-style indexing.


Choose the interface according to the input representation:

| Input or task | Interface | Units |
| --- | --- | --- |
| Inspect or slice an existing String | `string.byte`, `string.sub`, `string.len` | One-based codepoint positions and codepoint counts. |
| Construct text from character values | `string.char(...)` | Numeric Unicode codepoints. |
| Decode an encoded memory span | `string.from_utf8(address, byte_count)` | Mapped byte address and encoded byte count. |
| Format a Number or other value for display | `string.format(format, ...)` | The format selects textual representation, width and precision. |
| Build or read a formatted String record | `string.pack`, `string.unpack` | Codepoint-valued packet units; these calls do not transfer a record to mapped storage. |
| Interpret existing floating-point words | Named import `string/float/decode` | One binary32 word or high/low binary64 words; one Number result. |


In particular, the size of a packed String is not a DMA transfer length.
Define a byte layout in mapped storage when a device consumes bytes or words;
use String operations for language text and String records.


## Example: codepoints and mapped UTF-8 {#sec-bios-string-example-codepoints-and-mapped-utf-8}

Declare the encoded input as byte storage, then pass its address and byte count
to the BIOS. The resulting String is an independent text value:

```lua
rodata utf8_bytes: u8[8] = {
    0x41, 0x7a, 0xc3, 0xa9, 0xf0, 0x9f, 0x9a, 0x80,
}
local text = string.from_utf8(utf8_bytes, #utf8_bytes)
local length = string.len(text)              -- 4 codepoints, from 8 bytes
local second = string.byte(text, 2)          -- 122
local tail = text:sub(2, -1)                 -- codepoints 122, 233, 128640
local capitals = string.upper(text)          -- codepoints 65, 90, 233, 128640
local backwards = string.reverse(text)       -- codepoints 128640, 233, 122, 65
local repeated = string.rep('go', 3, '/')     -- 'go/go/go'
```

The same text can be constructed as
`string.char(0x41, 0x7a, 0xe9, 0x1f680)`. Method syntax uses the installed
String-index Table; it does not make String positions into memory addresses.


## Codepoint access, construction, length and UTF-8 input {#sec-bios-string-codepoint-access-construction-length-and-utf-8-input}

These four interfaces operate on codepoints or bring encoded bytes into a
String. Their names do not make a String a byte buffer.

| Interface | Arguments | Normal result |
| --- | --- | --- |
| `string.byte(value, position)` | Required String; optional Number position | Exactly one Number, or exactly one `nil` when the position is outside the String |
| `string.char(...)` | Zero or more Numbers | Exactly one String |
| `string.len(value)` | Required value supporting the length operation | Exactly one Number, if the operation completes |
| `string.from_utf8(address, byte_count)` | Numeric mapped byte address and a byte count | Exactly one String, if decoding completes with the installed bindings |


### `string.byte(value, position)` {#sec-bios-string-stringbytevalue-position}

Positions are one-based **codepoint positions**. Omitting `position`, or
passing `nil`, selects position 1. An empty String has no valid position.
A position below 1 or above the codepoint count returns one `nil`; negative
positions do not count back from the end.

A supplied non-`nil` position must be a Number. The conversion to a signed
32-bit word truncates a finite value toward zero, wraps modulo
4,294,967,296, and interprets the high bit as the sign bit. NaN and either
infinity convert to zero. This conversion is not the rounding used by every
other String operation.

For `value = string.char(65, 122, 233, 128640)`:

| Call | Result |
| --- | --- |
| `string.byte(value)` | `65` |
| `string.byte(value, nil)` | `65` |
| `string.byte(value, 2.9)` | `122` |
| `string.byte(value, 0x100000001)` | `65` |
| `string.byte(value, -1)` | `nil` |
| `string.byte(value, 5)` | `nil` |
| `string.byte(value, 2, 4)` | One result: `122` |

There is no end-position argument or range-return form. Additional arguments
are ignored.

A missing or non-String first argument, or a nonnumeric non-`nil` position,
raises `INVALID_ARGUMENT`. A numeric-looking String such as `"2"` is not
accepted as a position.

### `string.char(...)` {#sec-bios-string-stringchar}

Pass one Number for each Unicode scalar to put in the result. Values are not
restricted to 0 through 255. Each Number is converted to an unsigned 32-bit
word: a finite value is truncated toward zero and wrapped modulo
4,294,967,296; NaN and either infinity convert to zero. The converted value
must be in `0x000000` through `0x10ffff`, excluding `0xd800` through `0xdfff`.

| Call | Result |
| --- | --- |
| `string.char()` | One empty String |
| `string.char(65)` | One String containing codepoint 65 |
| `string.char(65.9)` | One String containing codepoint 65 |
| `string.char(0x100000041)` | One String containing codepoint 65 |
| `string.char(0)` | One String containing one zero codepoint |
| `string.char(233, 128640)` | One String containing those two codepoints |
| `string.char(-1)` | `INVALID_ARGUMENT` after conversion |
| `string.char(0xd800)` | `INVALID_ARGUMENT` |
| `string.char("65")` | `INVALID_ARGUMENT` |

Zero is an ordinary codepoint, not a String terminator. NaN and infinity
therefore produce a zero codepoint rather than an empty String. A nonnumeric
argument or a converted value outside the accepted scalar range raises
`INVALID_ARGUMENT`; decimal String arguments are not converted to Numbers.
The result is text, not an allocation of raw bytes at a mapped address.

For `byte` and `char`, `INVALID_ARGUMENT` is a language argument error. A
protected call receives the original error String `"Invalid argument."`.
It is not a Memory interrupt.

Each `byte` or `char` call has a builtin surcharge of two cycles, with no
per-argument, position or per-result term in that surcharge. The surrounding
BIOS instructions and ordinary calls have their own cycle charges.

### `string.len(value)` {#sec-bios-string-stringlenvalue}

`string.len(value)` performs the ordinary length operation, `#value`, and
returns its result. On a String it counts codepoints, including zero
codepoints. It does not report an encoded UTF-8 byte count.

On a Table it returns the maintained length, not the number of keys or
the largest numeric key. For the Table length operation, its state rules
and its fault handling, follow the CPU chapter's length-operation procedure.
Other value categories raise the ordinary length error,
`"Attempted to get length of an unsupported value."`.

### `string.from_utf8(address, byte_count)` {#sec-bios-string-stringfrom_utf8address-byte_count}

Use this interface when the input already exists as mapped UTF-8 bytes.
`address` is the numeric address of the first byte; `byte_count` is the number
of **encoded bytes**, not the number of codepoints. Supply both arguments.
A String value, or the address of a field holding a String constant index, is
not the address of its encoded text.

#### Text, codepoints and UTF-8 bytes {#sec-memory-text-codepoints-and-utf-8-bytes}

A static `string` field stores an image constant reference. Its byte address
locates that reference, not inline UTF-8. Similarly, `string.pack` produces a
String value rather than an addressed hardware buffer. Use explicit byte
storage for a device payload; the decoded String is not a retained DMA buffer.

This eight-byte span includes both a zero byte and a four-byte sequence:

```lua
rodata utf8_bytes: u8[8] = { 0x41, 0xc3, 0xa9, 0, 0xf0, 0x9f, 0x99, 0x82 }
local text = string.from_utf8(utf8_bytes, #utf8_bytes)
local count = #text
local zero = string.byte(text, 3)
local face = string.byte(text, 4)
```

Eight bytes decode to four codepoints: `0041H`, `00E9H`, `0000H`, `1F642H`.
`count` is 4, `zero` is 0 and `face` is `1F642H`. Embedded zero does not
terminate the String, and the supplementary codepoint counts as one. The
declaration's `#utf8_bytes` counts byte-array elements; `#text` counts
codepoints. These are different units even when both are expressed as Numbers.

#### Input lifetime and sequence reads {#sec-bios-string-input-lifetime-and-sequence-reads}

The caller must provide backed storage containing complete, well-formed
UTF-8 sequences and keep those bytes valid and stable while decoding reads
them. The function does not allocate the input storage or grant access to it.
An embedded byte `0x00` becomes codepoint zero and does not end the input.
With the installed bindings, a zero byte count returns one empty String.


The byte count controls whether another lead byte is read. It is **not a
hard read barrier** for the continuation bytes of a sequence already begun:

| Lead byte value | Bytes read for that sequence, including the lead |
| --- | --- |
| `0x00`–`0x7f` | 1 |
| `0x80`–`0xdf` | 2 |
| `0xe0`–`0xef` | 3 |
| `0xf0`–`0xff` | 4 |


These are the decoder's read shapes, not a validation table. The decoder does
not check continuation prefixes or reject overlong encodings before
constructing the codepoint. Continuation reads are not compared with the
end of the declared span. For example, if mapped bytes `0xc3, 0xa9` are both
present, declaring only one byte still reads the second byte and produces
codepoint `0xe9`. Do not use a shortened count to make an incomplete sequence
safe.

Malformed input does not have a replacement-character policy. For example,
the overlong sequence `0xc0, 0xaf` produces codepoint 47. A decoded surrogate,
such as the value produced by `0xed, 0xa0, 0x80`, reaches `char` and raises its
`INVALID_ARGUMENT` error. Mapped-access faults and their recovery belong to
the Memory, CPU and SYSTEM rules; there is no separate
invalid-UTF-8 error.

Literal escapes do not perform this decoding. The String literal
`"\xc3\xa9"` contains two codepoints, `0xc3` and `0xa9`. To obtain codepoint
`0xe9` from the encoded bytes `0xc3, 0xa9`, put those bytes in mapped storage
and call `string.from_utf8` with that address and a byte count of 2.

After normal return, the String is independent of the source bytes; rewriting
those bytes does not change the returned text.

The decoder retains its `char`, `table.unpack` and `table.concat` function
values. Replacing their public fields does not replace these calls. The
captured `unpack` still uses the current global `select` for an empty range;
the captured `concat` still uses the current global `tostring` for text
construction. Changing those globals can therefore change the empty-span or
text result. [BIOS table library](bios-table.md#sec-bios-table) describes the helper procedures.

## Case conversion, slicing, reversal and repetition {#sec-bios-string-case-conversion-slicing-reversal-and-repetition}

The contracts below describe the installed bindings. Each call returns exactly
one result when it completes. These functions do not write into their input.
For a String, positions and lengths count codepoints, including codepoint zero;
they do not count UTF-8 bytes.

| Call | Operation on a String |
| --- | --- |
| `string.upper(value)` | Change ASCII `a`–`z` to `A`–`Z`; preserve every other codepoint. |
| `string.lower(value)` | Change ASCII `A`–`Z` to `a`–`z`; preserve every other codepoint. |
| `string.sub(value, start_arg, end_arg)` | Select the inclusive codepoint range described below. |
| `string.reverse(value)` | Reverse the codepoint order. |
| `string.rep(value, count_arg, separator)` | Repeat the value; a non-nil separator is placed between copies. |

### ASCII case conversion {#sec-bios-string-ascii-case-conversion}

`upper` subtracts 32 from codes 97 through 122. `lower` adds 32 to codes
65 through 90. Neither operation performs locale-sensitive conversion or
Unicode case folding.

```lua
local text = string.char(65, 122, 233, 128640)
local capitals = string.upper(text) -- codes 65, 90, 233, 128640
local small = string.lower(text)    -- codes 97, 122, 233, 128640
```

The result contains the mapped codepoints in their original order. Empty
input returns an empty String. Supply a String: a positive-length Table fails
at character access with `Invalid argument.`, while unsupported length kinds
raise `Attempted to get length of an unsupported value.` A zero-length Table
reaches no character read and produces an empty String.

### Inclusive slices {#sec-bios-string-inclusive-slices}

Pass an explicit `nil` for `start_arg` when requesting its default; do not use
`string.sub(value)` as the direct-call form. A nil start means 1, and an omitted
or nil end means L, where `L = #value` is captured at the beginning of the call.

For each non-nil endpoint, first compute `q = endpoint // 1`. This is floor
division: for example, 2.9 becomes 2 and -1.2 becomes -2.

| Value of q | Start position | End position |
| --- | --- | --- |
| Positive | q | q |
| Negative | L + q + 1 | L + q + 1 |
| Zero or NaN | 1 | 0 |

After normalization, a start below 1 is raised to 1, and an end above L is
lowered to L. Thus -1 selects the last position. Unlike `table.concat` and
`table.unpack`, an explicit end of 0 means 0, **not** L.

The normalized range determines the result in this order:

| Condition | Result |
| --- | --- |
| End < start | One empty String. |
| Start = 1 and end = L | The original value, unchanged. |
| Start = end | The String constructed from that one codepoint. |
| Otherwise | Codepoints from start through end, joined in order. |

```lua
local middle = string.sub('ABCDE', 2.9, 4.9) -- 'BCD'
local tail = string.sub('ABCDE', -2, nil)     -- 'DE'
local empty = string.sub('ABCDE', 0, 0)       -- ''
local whole = string.sub('ABCDE', nil, nil)  -- original value
```

Non-Number endpoint values participate in arithmetic as NaN; numeric-looking
Strings are not parsed. Consequently `string.sub('ABCDE', '2', '4')` selects an
empty range: the start becomes 1 and the end becomes 0. This differs from
`string.byte`, which requires a supplied non-nil position to be a Number.

There is no preliminary String-only check here either. With a Table, the
empty-range branch can return an empty String and the full-span branch can
return that original Table. A partial range that reaches a codepoint read
raises `Invalid argument.` Other value kinds fail at `#value`.

### Codepoint reversal {#sec-bios-string-codepoint-reversal}

`string.reverse` captures `L = #value`. If L is at most 1, it returns the original
value. Otherwise, it returns the codepoints from positions L down to 1.

```lua
local backwards = string.reverse('ABC') -- 'CBA'
```

This reverses codepoints, not UTF-8 bytes or grapheme clusters. A combining
character therefore moves independently of its neighbouring codepoint.

The early return also applies to a Table whose captured L is 0 or 1: the result
is that Table, not a String. With a Table whose L is greater than 1, the first
codepoint read raises `Invalid argument.` Other value kinds fail at the length
operation.

### Repetition and separators {#sec-bios-string-repetition-and-separators}

A missing or nil count means 1. Otherwise, the count is `count_arg // 1`;
non-Number counts become NaN rather than being parsed or rejected by a
count-type check. A count at most zero returns one empty String before the
value or separator is concatenated.

For String inputs and a finite normalized count N > 0, the result contains
N copies. A non-nil separator goes between those copies, not before the first
or after the last.

```lua
local joined = string.rep('go', 3, '/') -- 'go/go/go'
local once = string.rep('go', nil)     -- 'go'
local none = string.rep('go', 0, '/')  -- ''
```

The function does not require the value or separator to be a String. Its
branch order determines the result:

| Count and separator | Procedure and result |
| --- | --- |
| Count ≤ 0, any separator | Return `''`; do not concatenate the supplied value or separator. |
| Count = 1, nil separator | Concatenate `'' .. value`; return the resulting String. |
| Count = 1, non-nil separator | Compute `separator .. value`, then return the original value. |
| NaN count, nil separator | Return `''`. |
| NaN count, non-nil separator | Compute `separator .. value`, then return the original value. |

For example, `string.rep(7, 1)` returns the String `'7'`, whereas
`string.rep(7, 1, '|')` returns the Number 7. `string.rep(7, 0, {})` returns `''`.
The String count `'3'` follows the NaN rows, not the finite-count rule.

Concatenation converts values to Strings using the ordinary conversion rules:
Numbers use their Number formatter, and nil, Booleans, Tables and functions use
their ordinary labels. It does not call `__tostring`. A separator is absent
only when it is nil; `false` is a supplied separator.

For a positive finite count, the requested output and its construction consume
language storage and processing time; there is no function-local repetition
or output-size cap. Negative infinity takes the empty-result branch.
Positive infinity is not a terminating repetition request and may exhaust
resources.

### Captured calls and work performed {#sec-bios-string-captured-calls-and-work-performed}

The codepoint-building paths above use captured `string.byte`, `string.char`
and `table.concat` function values. Replacing those public fields later does
not replace the captured calls. Their remaining live dependency is significant: the captured concat function still
consults the current global `tostring`. If that global is replaced with a
function returning `'x'` for every argument, `string.upper('ab')` produces
`'xx'`.

Mapping, slicing and reversal construct their results without modifying the
input String. Result construction uses the shared language-allocation budget
and executes BIOS instructions and calls; these are not in-place byte-buffer
operations.

## `string.format` {#sec-bios-string-stringformat}

```lua
string.format(format, ...)
```

Number arithmetic and value categories follow [Values and numeric instructions](cpu.md#sec-cpu-values-and-numeric-instructions). Hexadecimal limits below use the `H` suffix.

Builds formatted text and, on normal completion, returns exactly one String. It does not return a character count or write into a caller-supplied buffer. Unused arguments are ignored.

For a String `format`, positions, field widths and String precisions count Unicode codepoints, not UTF-8 bytes. Literal codepoints are copied in order. An embedded NUL does not terminate the format.

**Table-length dependency.** There is no String-only entry check: the first operation is `#format`. Categories other than String and Table fail at that operation. A Table whose length is obtained as zero returns an empty String; a positive length leads to a codepoint-read operation that requires a String and fails. The [CPU's maintained-length rules](cpu.md#sec-cpu-stored-length) also apply to the ordinary Table operations used during formatting.


### Example: formatted text {#sec-bios-string-example-formatted-text}

Width includes the sign and base prefix. In a starred field, supply width,
then precision, then the value:

```lua
local label = string.format('HP %d/%d', 7, 10)        -- 'HP 7/10'
local signed = string.format('%+06d', 42)             -- '+00042'
local hexadecimal = string.format('%#08x', 42)        -- '0x00002a'
local amount = string.format('%*.*f', 8, 2, 1.25)      -- '    1.25'
local left = string.format('%*s', -5, 'go')           -- 'go   '
local zeros = string.format('%.0d/%#.0o', 0, 0)       -- '/0'
local unsigned = string.format('%u', -1)              -- '4294967295'
local floating = string.format('%.2f/%.1e/%#.3g',
    1.25, 12.5, 100)                                 -- '1.25/1.3e+01/100.'
```

`string.format('%.0f', 1000000)` returns `'1e+06'`, because its whole-number
piece uses ordinary Number-to-text conversion. The conversion rules below
explain this output when choosing a numeric format.

### Conversion syntax and argument order {#sec-bios-string-conversion-syntax-and-argument-order}

An immediate `%%` emits one percent and consumes no argument. All other conversions have this order:

```text
% flags width .precision modifiers conversion
```

Each component except `%` and the final conversion is optional. The dot belongs to the precision component.

| Component | Accepted form |
| --- | --- |
| Flags | Any order and repetition of `-`, `+`, space, `0`, `#`. Repeating a flag has no additional effect. |
| Width | `*` or a run of ASCII decimal digits. Leading zeros are parsed as flags before the width stage. |
| Precision | `.` followed by `*` or zero or more ASCII decimal digits. A dot with no following digits records precision zero, provided a conversion still follows. |
| Modifiers | Any order and repetition of `l`, `L`, `h`. They are ignored and do not change the numeric representation. |
| Conversion | Exactly one of `s c d i u o x X f F e E g G q`. |

Decimal fields are accumulated by multiplying the previous value by ten and adding the next digit. There is no field digit-count or numeric cap. There is no positional `$` syntax. No additional conversion is supplied for `a`, `A`, `p` or `n`; a percent reached after parsing flags, width or precision is not the `%%` escape.

Arguments are selected sequentially: width `*` first, precision `*` second, then one value for a recognized conversion. An unsupported conversion does not select a conversion value, although its stars have already selected their arguments. There is no argument-count preflight or too-many-arguments error. With the installed argument-selection function, an exhausted argument list supplies Nil to a scalar selection; an omitted `format` is also Nil.

A star uses the first result of `math.modf`. For finite Numbers this truncates toward zero. A negative width enables left alignment and uses the negated width. A precision is retained only when its truncated value is nonnegative; a negative or NaN precision is absent. A non-Number star argument reaches this arithmetic as Number NaN, rather than being parsed as numeric text or rejected by a formatter-specific type check. For that width, the negative-width test and padding comparison are false; that precision is absent.

### Flags, signs and padding {#sec-bios-string-flags-signs-and-padding}

Width is a minimum, never a truncation limit. Padding measures the combined codepoint lengths of sign, base prefix and content. If padding is needed, `-` appends spaces and overrides `0`. Otherwise `0` inserts zeros after the sign and base prefix; ordinary padding inserts spaces before both.

For signed conversions, a value less than zero selects `-`; otherwise `+` selects `+`, then space selects one leading space. Thus `+` overrides space. Sign selection does not inspect a negative-zero sign bit.

| Conversion group | Flag and precision effects |
| --- | --- |
| `s`, `c`, `q` | Space padding only; `+`, space and `#` have no conversion effect. |
| `d`, `i` | Signed decimal; `+` and space select a nonnegative sign. `#` adds no prefix. |
| `u`, `o`, `x`, `X` | No sign from `+` or space. `#` affects octal and hexadecimal as described below. |
| All integers | Any present precision disables width zero-padding, including precision zero. |
| Floating conversions | Width zero-padding remains active when precision is present. `#` retains a point at zero precision in fixed/scientific construction and disables general-format zero stripping. |

### Text, codepoint and quoted conversions {#sec-bios-string-text-codepoint-and-quoted-conversions}

**`%s` — text.** Calls the current `tostring` on the argument, then, if precision is present, takes codepoints 1 through that precision before applying width. For an ordinary converted String, precision zero gives empty content. The argument need not originally be a String. Substring construction uses the maintained-length rule above.

**`%c` — one codepoint.** Takes the integer component from `math.modf` and
passes that one value to `string.char`. Conversion to an unsigned 32-bit word
truncates and wraps. A word above `10FFFFH` or within `D800H`–`DFFFH` raises the
codepoint error. NaN and either infinity convert to codepoint zero; non-Number
arguments also reach zero through the arithmetic conversion.

`string.format('%c', 0)` contains one NUL codepoint. Both
`string.format('%c', 65)` and `string.format('%c', 65.75)` produce `'A'`.
`string.format('%3c', 65)` produces two spaces followed by `'A'`. Precision is
ignored, although a precision star still consumes an argument.


**`%q` — quoted text.** Calls the current `tostring`, surrounds the resulting text with double quotes, and escapes its codepoints as follows:

| Codepoint | Emitted escape |
| --- | --- |
| 10 | `\n` |
| 13 | `\r` |
| 9 | `\t` |
| 92, backslash | `\\` |
| 34, double quote | `\"` |
| Other values below 32, and 127 | Backslash followed by the decimal code, zero-padded to three digits. |


Every other codepoint is copied unchanged. Width applies after quoting. Precision is ignored, including after consuming a precision star. Because conversion to text happens first, `%q` is not a promise of round-trip serialization of the original value.

### Integer conversions {#sec-bios-string-integer-conversions}

`%d` and `%i` take the first `math.modf` result. Finite fractions truncate toward zero, and a negative integer is formatted using its positive magnitude and a separate minus sign. These conversions do not impose a 32-bit word limit.

`%u`, `%o`, `%x` and `%X` take that same first result, apply a bitwise AND with `FFFFFFFFH`, and interpret the result as an unsigned 32-bit magnitude. `%u` uses decimal, `%o` octal, and `%x`/`%X` hexadecimal with lowercase/uppercase letters.

Zero initially produces one `0`. Other magnitudes are converted by repeated remainder and floor division in the selected base. Integer precision adds leading zeros to the requested minimum digit count. Precision zero clears the digits when the magnitude is zero.

For `#` octal, empty digits are restored to one `0`; otherwise a leading `0` is added only if the first digit is not already zero. For `#` hexadecimal, `0x` or `0X` is added only for a nonzero magnitude. The common width rules then place sign, prefix and padding.

A signed NaN magnitude produces no initial digits; sign flags, precision and width can still add text. Non-Number arguments reach signed integer formatting as Number NaN. Unsigned conversion maps both that result and Number NaN or either infinity to zero. Either infinity in signed integer conversion produces a positive-infinite magnitude; repeated base division then fails to make progress toward completion.

### Floating conversions {#sec-bios-string-floating-conversions}

`f`/`F` select fixed construction, `e`/`E` scientific construction, and `g`/`G` general construction. They do not validate the original argument as a Number or parse numeric Strings.

A Number NaN is handled before construction as `nan` or `NAN`; either infinity is handled as `inf` or `INF`. Sign selection is separate, so negative infinity receives a minus sign and nonnegative special values may receive `+` or space. For other arguments, sign is selected from the original value and a value less than zero is negated to obtain the magnitude.

Non-Number arguments do not match the initial Number-special cases. Comparisons with the numeric constants are false, and subsequent arithmetic produces Number NaN. The selected construction below therefore proceeds with NaN arithmetic and text pieces; this is not the initial `nan`/`NAN` shortcut or a formatter-specific argument error.


**Fixed construction (`f`, `F`).** Precision defaults to six; explicit zero is retained. For magnitude `v` and precision `p`, construct `scale` by starting at one and multiplying by ten `p` times, then calculate:

```text
rounded  = first modf result of (v * scale + 0.5)
whole    = rounded // scale
fraction = rounded % scale
```


Convert `whole` with the current `tostring`. When `p > 0`, append a dot and `tostring(fraction)`, padding that fraction text on the left with zeros to at least `p` codepoints. At precision zero, append a dot only for `#`.

**Scientific construction (`e`, `E`).** Precision also defaults to six. Zero uses fixed construction followed by exponent zero. Otherwise repeatedly divide the magnitude by ten while it is at least ten, or multiply it by ten while it is positive and below one, tracking the exponent from zero. Round the resulting mantissa using the same multiply-plus-half and first-`modf` operation. If the rounded value is at least `10 * scale`, divide it by ten using floor division and increment the exponent. Construct the whole/fraction text as above, then append `e` or `E`, an explicit exponent sign, and the current `tostring` of the absolute exponent, left-padded with zeros to at least two codepoints. Two is a minimum, not an exponent limit.

**General construction (`g`, `G`).** Precision defaults to six significant digits; explicit zero becomes one. Determine the decimal exponent from the unrounded magnitude, using exponent zero for zero. If the exponent is below −4 or at least the significant-digit precision, select scientific construction with precision one less than the significant-digit count. Otherwise select fixed construction with precision `significant − exponent − 1`. The choice is not repeated after rounding.

Without `#`, detach the first `e`/`E` suffix, remove every trailing zero from the preceding text, remove a trailing dot if present, and reattach the suffix. This stripping does not require a decimal point: it can remove integer trailing zeros as well. `#` skips stripping. `G` then applies ASCII-only uppercasing to the resulting text. Stripping and uppercasing use the maintained-length rule above.

**Default numeric text dependency.** The whole, fraction and exponent text pieces above use `tostring`; precision does not substitute an arbitrary-length decimal writer. Under the installed default, Nil becomes `nil`, Booleans become `false` or `true`, Tables become `table`, Threads become `thread`, function values become `function`, and Strings retain their contents. Number specials become `nan`, `-inf` or `inf`.

For finite Numbers, default text conversion writes positive zero as `0`, preserves a received negative zero as `-0`, and writes nonzero integral magnitudes below 1,000,000 exactly. Other finite-number text uses a six-significant-digit general algorithm: normalize, scale by 100,000, round with ties to even, adjust a six-digit carry, then choose fixed notation only for a post-rounding exponent from −4 through 5. Otherwise it uses lowercase `e`, an explicit sign and at least two exponent digits. Fractional trailing zeros are removed. This text algorithm is distinct from the formatter's multiply-plus-half rounding. Consequently, requested floating precision does not guarantee that all whole/fraction pieces are plain fixed decimal digits, or that every requested decimal digit is accurate.

### Errors, completed work and limits {#sec-bios-string-errors-completed-work-and-limits}

With the installed `error`, an incomplete conversion raises the String:

```text
string.format incomplete format specifier.
```

This includes a final bare `%`, a final dot, and a conversion that ends after its flags, fields or ignored modifiers. An unsupported conversion raises `string.format unsupported format specifier '%C'.`, where `C` is replaced by that actual codepoint, not restricted to ASCII.


The formatter processes conversions in order. An error can occur after
earlier argument selections or conversions; the call returns no partial
String or count. Length and codepoint errors retain their ordinary texts.


The formatter keeps its original character, substring, repetition,
concatenation and truncation functions. Its `tostring`, `select` and `error`
calls use current globals. Replacing a saved helper's public field leaves
the saved function in place; that helper can still use current globals of its
own.

Choose finite widths and precisions appropriate to the output. Large
padding and decimal precision create more text and require more processing.
Positive-infinite precision prevents the scaling loop from progressing;
positive-infinite width can prevent repetition from completing.

## Pattern language {#sec-bios-string-pattern-language}

Patterns examine String codepoints, not UTF-8 bytes or grapheme clusters. Positions are codepoint positions. Character classes are ASCII classes; they do not expand to Unicode categories or locale-dependent character groups.

A pattern is interpreted as matching reaches it. There is no separate whole-pattern validation pass. An empty remaining pattern succeeds without consuming input.



### Example: patterns and substitutions {#sec-bios-string-example-patterns-and-substitutions}

Capture a record's text fields, then convert the numeric fields explicitly:

```lua
local name, x_text, y_text = string.match('ship_17 x=12 y=-3',
    '^(%w+)%s+x=(%-?%d+)%s+y=(%-?%d+)$')
local x, y = tonumber(x_text), tonumber(y_text)       -- 12, -3
local start, finish = string.find('a.b', '.', 1, true) -- 2, 2: literal dot
local position, digits = string.match('tag=42', '()(%d+)') -- 5, '42'

for word in string.gmatch('cat dog ship_17', '%w+') do
    print(word)                                     -- cat, dog, ship_17
end
local text, count = string.gsub('red blue', '(%a+)', '[%1]')
-- text is '[red] [blue]'; count is 2.
```


The following worked values distinguish matching and replacement choices:

| Call | Results |
| --- | --- |
| `string.match('a1b2b', 'a.*b')` | `'a1b2b'` |
| `string.match('a1b2b', 'a.-b')` | `'a1b'` |
| `string.match('x(a(b)c)y', '%b()')` | `'(a(b)c)'` |
| `string.match('cat scatter', '%f[%w]cat%f[%W]')` | `'cat'` |
| `string.match('go go stop', '(%w+)%s+%1')` | `'go'`, the captured text |
| `string.find('abc', '', 4)` | One `nil` |
| `string.match('abc', '', 4)` | `''` |
| `string.gsub('red blue', '(%a+)', { red = false })` | `'false blue'`, `2` |
| `string.gsub('abc', '', '_')` | `'____'`, `4` |
| `string.gsub('x', '[', false, 0)` | `'x'`, `0`; matching is skipped |

A Function replacement can retain a match by returning false. Unlike a Table
replacement's false value, that return is not converted to text:

```lua
local changed, count = string.gsub('red blue', '(%a+)', function(word)
    if word == 'red' then
        return false
    end
    return 'B', 'ignored'
end)
-- changed is 'red B'; count is 2. Only the first return value is used.
```

### Single-codepoint atoms and escapes {#sec-bios-string-single-codepoint-atoms-and-escapes}

An ordinary character matches the same codepoint. A dot, `.`, matches any available codepoint, including a newline. An escaped punctuation character matches that punctuation literally: for example, `%.` denotes a literal dot.


The named classes are:

| Class | Members |
| --- | --- |
| `%a` | ASCII `A`–`Z` and `a`–`z` |
| `%c` | Codepoints at most 31, and codepoint 127 |
| `%d` | `0`–`9` |
| `%g` | Codepoints 33–126 |
| `%l` | `a`–`z` |
| `%p` | Codepoints 33–47, 58–64, 91–96, and 123–126 |
| `%s` | Space and codepoints 9–13 |
| `%u` | `A`–`Z` |
| `%w` | ASCII letters, digits, and underscore |
| `%x` | `0`–`9`, `A`–`F`, and `a`–`f` |
| `%z` | Codepoint 0 |


Every uppercase ASCII letter following `%` complements the match for its lowercase letter. This rule is not restricted to the named classes: `%D` matches a non-digit, while `%Q` matches anything except lowercase `q`. An otherwise unrecognised nonuppercase escape matches its token literally; `%q` matches `q`, and `%0` matches `0`. Outside bracket sets, `%b`, `%f`, and `%1` through `%9` instead introduce the special constructs described below.

The character `|` does not introduce alternation. Braces do not introduce counted repetition, and backslash is not the pattern escape character. The characters `*`, `+`, `-`, and `?` act as repetition suffixes only when examined immediately after an ordinary atom. When encountered as a new atom, one of these characters is literal and can itself have a following repetition suffix.

The ordinary single-character check rejects positions beyond the source length, but does not itself reject positions below 1. A search begun sufficiently far below the first codepoint therefore follows below-range codepoint reads and String substring indexing; it does not acquire an implied lower clamp or a guarantee of ordinary 1-based matching boundaries.

### Bracket sets {#sec-bios-string-bracket-sets}

A bracket set, `[...]`, is an ordinary one-codepoint atom. A `^` immediately after `[` negates membership. The set scanner skips `%` and its following position, and the first other `]` closes the set. An unescaped `]` closes it even when it would be the first member. Write `%]` to include a literal closing bracket.

Inside a set, escapes use the class rules above. Named classes, uppercase complements, and escaped literals are available. The outside-set constructs are not available there: `%b` and `%f` mean literal `b` and `f`, and `%1` means literal `1`.

A range is recognised when an unescaped, single-item left member is followed by `-`. Its right endpoint must also parse as one item for range membership to match. Endpoints are compared as numeric codepoints, inclusively; reversed endpoints match nothing. An escaped endpoint does not form an ordinary codepoint range. A right-side escape can be consumed without contributing range membership.

Do not assume a final hyphen is literal. The range scanner can take the set's closing `]` as the right endpoint. Write `%-` when literal hyphen membership is required.

An unescaped `[` encountered while set membership is traversed is itself passed to the bracket-item parser. This can skip subsequent text; it is not a nested-set union operation. Write `%[` for literal opening-bracket membership.

An empty positive set matches nothing. An empty negated set matches any available source codepoint. A reached `[` without an unescaped closing `]` raises `invalid string pattern`.

### Anchors and search order {#sec-bios-string-anchors-and-search-order}

Only a `^` at the first pattern position is an anchor. It is removed before matching and restricts the search to its supplied starting position. It does not independently assert the absolute beginning of the String. In repeated matching or substitution, it restricts each search to that operation's current search position. A `^` elsewhere is literal, except for set negation immediately after `[`.

Only a `$` at the final pattern position is an end anchor. It succeeds exactly when the current position is one past the source's last codepoint. A `$` elsewhere is literal.

Without a leading `^`, candidate starts are tried in increasing order, through the position one past the source end. The first successful candidate wins. Capture bookkeeping starts afresh for each candidate. The search does not silently switch to literal searching merely because a pattern looks literal.

### Greedy and minimal repetition {#sec-bios-string-greedy-and-minimal-repetition}

Repetition applies to ordinary single-codepoint atoms, including bracket sets and ordinary escaped classes.

| Suffix | Matching order |
| --- | --- |
| `?` | Try one occurrence, then zero |
| `*` | Greedy zero or more: try the longest span first, then shorter spans |
| `+` | Require one occurrence, then greedily expand the remainder |
| `-` | Minimal zero or more: try the remaining pattern first, then consume another codepoint if needed |

These choices depend on whether the rest of the pattern succeeds. Greedy matching can retreat from its longest span; minimal matching can grow beyond an empty span.

Capture delimiters, balanced matching, frontier matching, and backreferences take their own matching branches before repetition suffixes are considered. They cannot be repeated as groups or special constructs. A following `*`, `+`, `?`, or `-` is processed separately as an ordinary atom, not as repetition of that preceding construct. There is no alternation or counted-repeat construct.

### Captures and backreferences {#sec-bios-string-captures-and-backreferences}

An opening `(` records the current source position. A closing `)` searches backwards for the most recent capture entry whose finish is still unset and records its finish at the current position. A text capture is extracted from its recorded start through one codepoint before its finish. Capture entries are created in opening order.

The form `()` is different: it records the numeric current position without consuming text. It is a position capture, not an empty text capture.

**Capture-result dependency.** Capture bookkeeping and extraction use the [CPU's maintained Table lengths](cpu.md#sec-cpu-stored-length). Returned sequences also follow the ordinary caller's result adjustment.

Outside sets, `%1` through `%9` refer to a previously recorded, finished text capture. A backreference compares that capture's codepoints at the current source position and, on success, advances by the captured length. A missing capture, an unfinished capture, or a position capture raises `invalid string pattern capture` when that reference is reached.

A backreference has exactly one digit. `%10` is `%1` followed by literal `0`; it is not a reference to capture 10. Capture creation has no pattern-local count guard, but the backreference notation still names only entries 1 through 9.

A reached `)` raises `invalid string pattern` if the backwards search finds no entry with an unset finish. That search tests only the finish field; it does not exclude position-capture entries. Structurally odd combinations of position captures and closing parentheses therefore follow that same procedure, rather than a separate balanced-parenthesis validity rule.

Reaching the pattern end does not check for unfinished opening captures. If such a capture is later extracted, extraction computes its finish minus one even though the finish is unset. There is no dedicated unclosed-capture error at pattern end.

### Balanced regions {#sec-bios-string-balanced-regions}

The form `%bxy` requires the current source codepoint to be `x`. It scans forwards with an iterative depth counter, increasing depth for nested `x` and decreasing it for `y`. When a closing `y` reduces depth to zero, matching continues just after that closing codepoint and after the four-codepoint `%bxy` construct in the pattern. A different starting codepoint, or failure to find a closing delimiter, makes this match fail.

The closing-delimiter comparison is performed before the opening-delimiter comparison. This order also applies when `x` and `y` are the same codepoint.

There is no dedicated preliminary check that both delimiter positions exist. An incomplete `%b` construct proceeds through two String delimiter reads and then the balance scan.

### Frontiers {#sec-bios-string-frontiers}

The form `%f[set]` is zero-width. It requires the preceding codepoint not to belong to the set and the current codepoint to belong to it. The preceding value is codepoint 0 when the current position is at most 1; otherwise it is read from the preceding String position. The current value is read from the String when the position is at most the source length; otherwise it is codepoint 0. The read applies the signed-32 position conversion of `string.byte`. A converted position below 1 returns `nil`, not codepoint 0. These values take part in the ordinary set-membership test.

The `[` must immediately follow `%f`; otherwise a reached frontier construct raises `invalid string pattern`. Its set uses the same scanner, membership rules, and missing-closing-bracket error as an ordinary bracket set. A successful frontier consumes no source codepoint.

### Reached errors and incomplete forms {#sec-bios-string-reached-errors-and-incomplete-forms}


Pattern syntax has these explicit error conditions:

| Reached condition | Error text |
| --- | --- |
| A bracket item has no unescaped closing `]` | `invalid string pattern` |
| `%f` is not immediately followed by `[` | `invalid string pattern` |
| `)` finds no capture entry with an unset finish | `invalid string pattern` |
| `%1`–`%9` names a missing, unfinished, or position capture | `invalid string pattern capture` |


These error Strings are passed to the current global `error` function. String, Table and arithmetic operations retain their own errors.

Only reached pattern text is parsed. A failed earlier atom can leave later malformed text unexamined, and a search can finish after its first successful candidate or its single anchored candidate. Conversely, a bracket atom is parsed before the ordinary character check rejects a position beyond the source end; source exhaustion does not universally shield a reached bracket error.

Some operations can avoid the matcher altogether: `find` can return at its initial start bound, creating a `gmatch` iterator does not invoke it, and `gsub` can skip its first matching iteration when its limit comparison is false. Those paths do not validate the unused pattern.

A terminal `%` has no dedicated rejection. Special-escape dispatch first reads a missing token; the ordinary item scan then advances by two pattern positions. If single-codepoint matching is reached, a source position greater than the String length fails before class matching; otherwise class matching receives the missing escape token. Numeric comparisons reached with that missing token are false. Incomplete balanced constructs, unfinished captures and odd capture closures follow their respective operations above rather than a separate syntax-validation pass.

## Pattern searches and substitutions {#sec-bios-string-pattern-searches-and-substitutions}

Pattern calls return positions, captured substrings or replacement text as
specified below. Capture and result sequences use ordinary Table lengths and
ordinary call-result adjustment. The [CPU reference](cpu.md#sec-cpu-stored-length)
defines those rules. Matching and substitution also allocate temporary
language objects; budget for them when processing large text.

### `string.find` {#sec-bios-string-stringfind}

```text
string.find(source, pattern [, start [, plain]])
```

Searches `source` and constructs the start and inclusive end positions of the first match. Positions count String codepoints, beginning at 1; they are neither UTF-8 byte offsets nor grapheme-cluster positions. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax, capture ordering and position captures.

**Arguments and starting position.** Omitted or nil `start` means 1. Otherwise the function computes `start // 1`: a positive result is used directly, a negative result becomes `#source + result + 1`, and zero becomes 1. A result still below 1 is not clamped. Do not rely on such a start producing ordinary in-range match boundaries. This arithmetic does not parse numeric Strings; a nonnil non-Number makes both sign comparisons false and therefore normalizes to 1.

If the normalized start is greater than `#source`, `find` returns one nil before inspecting `plain` or the pattern. In particular, a start of `#source + 1` takes this return, even for an empty pattern. Otherwise a pattern search can consider candidates through `#source + 1`. A leading `^` restricts the search to the supplied start; it does not independently assert the beginning of the complete source.

**Literal search.** A truthy `plain` selects literal codepoint comparison instead of the pattern language. Only nil and false disable this option: 0 and the empty String enable it. An empty literal needle constructs `(start, start - 1)` after the initial bound check above. A nonempty needle searches candidate positions in increasing order and constructs the first start/inclusive-end pair; failure returns one nil. Literal search does not interpret captures or any other pattern syntax.

**Pattern results.** Failure returns one nil. On success, `find` builds a result sequence beginning with the match's start and inclusive end. If there are captures, it appends their values in opening order: substring captures are Strings and position captures are Numbers. With no captures, it builds only the two positions. The result sequence is then expanded into return values.

**Shared arguments and errors.** Supply Strings for `source` and `pattern`.
Missing fixed parameters are nil and surplus arguments are ignored. Any
failure is reported by the length, character, substring or other operation
reached; the pattern interface does not coerce supplied values into text.

Patterns are interpreted as matching reaches them, not validated in a separate pass. Reached syntax errors explicitly raise `invalid string pattern` for an unterminated bracket set, `%f` without its immediately following `[`, or a closing capture with no unfinished capture to close. A reached backreference to a missing, unfinished or position capture raises `invalid string pattern capture`. A terminal `%`, incomplete `%b` delimiters and unfinished opening captures do not have dedicated validation errors; they follow the corresponding operations. See [Pattern language](#sec-bios-string-pattern-language) for the corresponding parsing rules.

Pattern operations save their installation-time `byte`, `sub`, `concat`,
`unpack`, `tonumber`, `tostring` and `type` functions. Their explicit errors
use current global `error`. Changing a helper's public binding leaves the
saved reference unchanged, while any globals used by that helper remain live.

Pattern search can backtrack and try multiple candidate positions. Pattern size, nesting and input therefore affect work; there is no pattern-local work-step or recursion-depth limit.

### `string.match` {#sec-bios-string-stringmatch}

```text
string.match(source, pattern [, start])
```

Searches for the first pattern match, using the codepoint positions, start normalization, binding dependencies and reached-error rules described under `string.find`. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax.

The default start is 1. A nonnil start is processed with `// 1`, negative positions are relative to the end, zero becomes 1, and an excessively negative result is not clamped. Unlike `find`, `match` does not first reject a start greater than `#source`; its search considers candidates from the supplied start through `#source + 1`. A leading `^` restricts it to the supplied start.

Failure returns one nil. On success, `match` builds a result sequence containing the whole matched substring if there are no captures, or the capture values in opening order otherwise. Substring captures are Strings; position captures are Numbers. It expands that sequence into return values, without adding start/end positions.

There is no plain-search argument. Surplus arguments are ignored, rather than selecting a different search mode.


### `string.gmatch` {#sec-bios-string-stringgmatch}

```text
string.gmatch(source, pattern)
```

Returns one iterator function. The outer call captures `source` and `pattern` and initializes its search position to 1; it does not inspect either input or parse the pattern before returning. It does not return separate state and control values. Surplus outer-call arguments are ignored.


Call the returned function with no arguments; any supplied arguments are ignored. Each call searches from its current codepoint position. Success constructs and expands the same result sequence as `string.match`: the whole match when there are no captures, otherwise capture values in opening order. Failure returns one nil.

After a nonempty match, the next search starts at the match's exclusive end. After an empty match, it starts one position beyond that exclusive end. The search position changes before capture extraction and return-value construction, so an error during those operations can occur after the iterator has advanced. A failed search leaves the position unchanged; there is no latched finished state, and another call repeats that failed search.

A leading `^` applies at each current search position, not just at the absolute beginning of `source`. The iterator does not search for overlapping nonempty matches inside a span it has already consumed. See [Pattern language](#sec-bios-string-pattern-language) for the matching rules and `string.find` for shared bindings and reached errors; those errors are deferred until an iterator call reaches the relevant operation.

One iterator call performs one complete search, which can examine all remaining candidate positions and backtrack.

### `string.gsub` {#sec-bios-string-stringgsub}

```text
string.gsub(source, pattern, replacement [, limit])
```

Builds a substituted String and returns it together with the substitution count. Positions and substring boundaries are codepoint-based. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax and `string.find` for shared binding dependencies and reached pattern errors.

**Limit and count.** Omitted or nil `limit` means `#source + 1`. Otherwise the function computes `limit // 1` and replaces a negative result with 0. A zero limit skips matching and replacement entirely, assembles the unchanged source tail, and returns that String with count 0. A nonnil non-Number limit does not parse as a numeric String or raise a `gsub`-specific integer error: its arithmetic result fails the loop comparison, so the replacement loop is likewise skipped.

The count increases after a successful replacement evaluation, including an evaluation that chooses to keep the original match. The limit bounds completed replacement iterations, not the work spent finding a match, backtracking, looking up a replacement or running a replacement function.

**Replacement arguments.** For each match, the function constructs a replacement-argument sequence: the whole matched substring when there are no explicit captures, otherwise capture values in opening order. Substring captures are Strings and position captures are Numbers. The whole match remains separately available to the replacement rules below.

- **String or Number:** first convert the replacement with the retained `tostring`, then parse its text. Ordinary codepoints copy literally. `%%` emits `%`; `%0` emits the whole match. For another codepoint following `%`, the retained `tonumber` is used: a numeric result selects that numbered replacement-argument entry, and a missing entry contributes an empty String; a nonnumeric token is emitted without the `%`. A final lone `%` is copied literally. Consequently `%1` refers to the whole match when there are no captures. Numeric position-capture values reach the output conversion as Numbers.
- **Table:** use the first replacement argument as the key when the argument sequence has entries, otherwise use the whole match. This is an ordinary table lookup. Its metatable lookup follows Table-valued `__index` chains; it does not call a Function-valued `__index`. A nil result keeps the whole match. Every other result, including false, is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.
- **Function:** pass the replacement arguments separately when their sequence has entries, otherwise pass the whole match. Only the first return value is used. Nil or false keeps the whole match; any truthy value is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.

A replacement of any other kind raises exactly `string.gsub replacement must be a string, number, function, or table.` only when a match reaches replacement evaluation. A zero limit or an unsuccessful search does not prevalidate the replacement.

**Search advancement and assembly.** Searching begins at position 1. For each match, the function appends the unmatched prefix and the evaluated replacement. A nonempty match moves both the next search position and the beginning of the remaining source tail to the match's exclusive end; it does not search for overlaps inside the consumed span.

For an empty match, after replacement evaluation the function first checks the *previous* search position. If that position is already greater than `#source`, it stops. Otherwise it sets both the next search position and the remaining-tail position to one position beyond the empty match's exclusive end. This advances past a source position without appending that position's codepoint. An empty match immediately after a nonempty match is not automatically suppressed.

After substitution stops, the remaining source tail is appended and the output pieces are concatenated. A leading `^` is applied at every current search position, not as a one-time absolute-source-beginning restriction.

A replacement function can have observable effects before a later match or operation fails. Those effects are not rolled back. If a reached operation raises an error, `gsub` does not return a partial output or count. Its private count advances only after replacement evaluation returns. The substitution limit does not bound output size or matching work.

## Floating-point word decoder {#sec-bios-string-floating-point-word-decoder}

The named BIOS import `string/float/decode` binds a static call target,
not a runtime library Table or a first-class function value:

```lua
local decode_float<const> = require('string/float/decode')
local sample = decode_float(0x3fa00000, 0, 4)        -- 1.25
local calibration = decode_float(0xc0040000, 0, 8)  -- -2.5
```

Its signature is `decode_float(high, low, byte_count)`, with one Number result.
Pass the raw unsigned words after reading them in the record's byte order:

| Argument | Four-byte form | Eight-byte form |
| --- | --- | --- |
| `high` | Complete 32-bit field | High 32 bits, containing sign and exponent |
| `low` | Unused; conventionally 0 | Low 32 bits |
| `byte_count` | 4 | 8 |

Exactly `byte_count == 4` selects the four-byte form; every other value selects
the eight-byte calculation. There are no separate word-range or argument-type
checks. Both forms use the field extraction and Number arithmetic under
[Decoding](#sec-bios-string-decoding), without reading a String or mapped memory. Surplus
arguments are ignored. This import does not supply a separate public encoder.


## String packet packing {#sec-bios-string-string-packet-packing}

`string.pack`, `string.packsize`, and `string.unpack` construct and read formatted packets held in a BLua String. The format determines field widths, signedness, byte order, and padding.

```text
packet = string.pack(format, ...)
size = string.packsize(format)
v1, v2, ..., next_pos = string.unpack(format, packet [, pos])
```


- `pack` returns one String. Each integer, floating-point, or text field consumes one argument, including a zero-width `c0` field. Controls and padding consume none. Extra arguments are ignored.
- `packsize` returns one Number: the size of a fixed-size format, including its padding. A format containing `z` or `s` is variable-length and causes an error.
- `unpack` returns one value for each integer, floating-point, or text field, followed by the next one-based source position. Controls and padding produce no values. An empty or control-only format normally returns only that position.

**Shared Table dependency.** Temporary packet pieces and unpacked-result
collections use the [CPU's maintained Table lengths](cpu.md#sec-cpu-stored-length),
including when every supplied format and operand is a String. Accepted Table
operands are retained in the argument-category account below. Ordinary caller
result adjustment still applies.

For example, these calls construct and read a fixed-width record without transferring it to mapped memory:

```lua
local format = "<I2c4"
local packet = string.pack(format, 513, "BMSX")
local size = string.packsize(format)
local kind, tag, next_pos = string.unpack(format, packet)
```

The packet contains codepoints 1, 2, 66, 77, 83, 88. Its size is 6; unpacking returns 513, 'BMSX', then next position 7.

### Packet units are String codepoints {#sec-bios-string-packet-units-are-string-codepoints}

BLua String lengths and positions count Unicode codepoints, not UTF-8 bytes. This also applies to packing formats and packets. In this section, a **packet unit** means one String codepoint.

Numeric fields and padding written by `pack` contain codepoints in the range 0–255. Text fields copy their source codepoints without imposing that range. Consequently, a packed String is not necessarily a sequence of octets, and it is not a mapped byte buffer or an address.

`unpack` reads numeric digits as codepoint values. It neither checks that a digit is at most 255 nor masks it to eight bits. A text field containing a larger codepoint can therefore affect a later numeric interpretation.

For example, `string.pack("c1", string.char(256))` copies codepoint 256 into one packet unit. Reading that one-unit String with `B` accumulates the Number 256; reading it with `b` applies the signed subtraction once and obtains 0. In either calculation the next position is 2. These are consequences of the codepoint representation, not octet-storage behavior.

The returned packet is a String value. Packing does not allocate mapped storage or copy packet units to a byte address.



### Example: a packed record {#sec-bios-string-example-a-packed-record}

The format below combines a fixed header, a length-prefixed payload and a
zero-terminated status. Maximum alignment 4 places the eight-unit `d` field at
offset 12 rather than 16. The payload's zero codepoint is content in `s1`;
using `z` for that payload would raise an error.

```lua
local header_format = '< !4 B H > h < f d c3'
local payload = 'A' .. string.char(0) .. 'B'
local record = string.pack(header_format .. ' s1 z',
    1, 4660, -300, 1.25, -2.5, 'POSITION', payload, 'ready')
local header_size = string.packsize(header_format)   -- 23
local record_length = #record                       -- 33
local version, flags, delta, sample, calibration, tag, next_pos =
    string.unpack(header_format, record)
local decoded_payload, status, after_record =
    string.unpack('s1 z', record, next_pos)
```


The header returns `1`, `4660`, `-300`, `1.25`, `-2.5`, `'POS'`, then next
position 24. The second call returns the three-codepoint payload, `'ready'`,
then position 34. These are one-based continuation positions, not lengths.

| Zero-based offset | Field | Packet codepoints |
| --- | --- | --- |
| 0 | `B` version | 1 |
| 1 | Alignment padding | 0 |
| 2–3 | Little-endian `H` flags | 52, 18: value 4660 |
| 4–5 | Big-endian `h` delta | 254, 212: value −300 |
| 6–7 | Alignment padding | 0, 0 |
| 8–11 | Little-endian `f` sample | 0, 0, 160, 63: value 1.25 |
| 12–19 | Little-endian `d` calibration | 0, 0, 0, 0, 0, 0, 4, 192: value −2.5 |
| 20–22 | `c3` tag | 80, 79, 83: `POS`, truncated from `POSITION` |
| 23 | `s1` payload prefix | 3 |
| 24–26 | Payload | 65, 0, 66 |
| 27–32 | `z` status | 114, 101, 97, 100, 121, 0: `ready` and terminator |

### Formats {#sec-bios-string-formats}

Each call begins in little-endian order with maximum alignment 8. `pack` and `packsize` start at zero-based offset 0. `unpack` begins at the source offset selected by `pos`.

Only the following whitespace is ignored between format tokens: space and codepoints 9–13. A numeric suffix consists of consecutive ASCII decimal digits. There is no sign, decimal point, separator, or internal whitespace in a suffix. The suffix reader has no general digit-count or numeric upper bound; the individual options below impose their own restrictions.


In the tables, `A` is the current maximum alignment, and all widths and alignments count packet units. Defaults are fixed, not inferred from a machine word size.

| Option | Field | Width | Alignment | Arguments / data results |
| --- | --- | ---: | --- | --- |
| `b` | Signed integer | 1 | `min(A, 1)` | 1 / 1 |
| `B` | Unsigned integer | 1 | `min(A, 1)` | 1 / 1 |
| `h` | Signed integer | 2 | `min(A, 2)` | 1 / 1 |
| `H` | Unsigned integer | 2 | `min(A, 2)` | 1 / 1 |
| `l` | Signed integer | 4 | `min(A, 4)` | 1 / 1 |
| `L` | Unsigned integer | 4 | `min(A, 4)` | 1 / 1 |
| `j` | Signed integer | 8 | `min(A, 8)` | 1 / 1 |
| `J` | Unsigned integer | 8 | `min(A, 8)` | 1 / 1 |
| `i[N]` | Signed integer | `N`, default 4; explicit `N` must be 1–8 | `min(A, N)` | 1 / 1 |
| `I[N]` | Unsigned integer | `N`, default 4; explicit `N` must be 1–8 | `min(A, N)` | 1 / 1 |
| `T` | Unsigned integer | 4 | **4, regardless of `A`** | 1 / 1 |
| `f` | Floating-point field | 4 | `min(A, 4)` | 1 / 1 |
| `d` | Floating-point field | 8 | `min(A, 8)` | 1 / 1 |
| `n` | Floating-point field | 8 | `min(A, 8)` | 1 / 1 |
| `cN` | Fixed-width text | `N`; suffix required, zero permitted | 1; no automatic padding | 1 / 1 |
| `z` | Zero-terminated text | Content length + 1 | 1 | 1 / 1 |
| `s[N]` | Length-prefixed text | Prefix width + content length; prefix defaults to 4, explicit width 1–8 | `min(A, prefix width)` before the prefix | 1 / 1 |
| `x` | Padding | 1 | No additional alignment | 0 / 0 |
| `X` | Align for a following field | Padding only; see below | Determined by lookahead | 0 / 0 |


`[N]` marks an optional suffix in this table; the square brackets are not format characters. The `f`, `d`, `n`, and `z` options do not read a width suffix. `cN` has no parser-imposed maximum width.

| Control | Effect |
| --- | --- |
| `<` | Select little-endian numeric order. |
| `>` | Select big-endian numeric order. |
| `=` | Select the fixed default: little-endian order. |
| `!N` | Set maximum alignment to positive decimal `N`. The suffix is required. It need not be a power of two; there is no upper-bound check in this control. |

Controls consume neither packet units nor arguments and return no data values. Every other option is unsupported. Parsing and field processing are interleaved; there is no separate up-front format-validation pass.

#### Alignment and padding {#sec-bios-string-alignment-and-padding}

Before an aligned field, padding is calculated from the current zero-based offset:

```text
padding = 0                                      when alignment <= 1
padding = (alignment - offset % alignment) % alignment   otherwise
```

Offsets include all earlier fields and padding. In `unpack`, alignment uses the absolute source offset, including the starting position; it does not begin a new alignment origin at the selected subrecord. No call adds implicit final record padding.

`pack` writes zero codepoints for all padding. `unpack` checks that skipped padding fits within the source but does not inspect its contents. Padding need not contain zero to be accepted.

`X` looks ahead to find an alignment without consuming the following field. Its lookahead skips `x`, further `X` options, and endian/alignment controls, while tracking the controls' future state locally. The main parser still processes all those options later. The chosen alignment is:

- an integer field's alignment, including the fixed alignment 4 for `T`;
- a floating-point field's alignment;
- an `s` field's prefix alignment;
- the full width `N` for `cN`, **not** 1 and not a width limited by `A`;
- 1 for `z` or the end of the format.

For example, `string.packsize("!1bT")` is 8, and `string.packsize("bXc3")` is 6. A trailing `X` adds no padding.

### Integer fields {#sec-bios-string-integer-fields}

Integer fields use ordinary BLua Numbers, not a separate exact 64-bit integer type.

For packing, the value is first divided by 1 with `//`. If the result differs from the original value, the call reports an integer-value error. Fractional Numbers are therefore rejected, not rounded into valid integer arguments. Numeric Strings, Booleans, Tables, nil, and a missing argument are not coerced into integers. Numeric NaN fails the same test. Positive and negative infinity reach the safe-range error.

The value must then lie within the safe integer interval:

```text
-9007199254740991 <= value <= 9007199254740991
```

It must also fit the selected field width `w`:

| Field | Accepted width range before the safe-integer restriction |
| --- | --- |
| Signed | `-(256^w)/2` through `(256^w)/2 - 1` |
| Unsigned | `0` through `256^w - 1` |

A negative signed value is encoded by adding `256^w` once. Exactly `w` base-256 digits are then written in the selected order. Little-endian writing takes `% 256` and repeatedly divides by 256 with `//`; big-endian writing uses descending powers of 256.

**Seven- and eight-unit signed fields require particular care.** The positive value after that addition can exceed the exact integer interval even when the accepted input does not. Do not assume exact 64-bit wrapping or a general signed seven-/eight-unit round trip.

On reading, digits are accumulated as an unsigned Number in the selected order. An accumulated value greater than 9007199254740991 is rejected **before** signed interpretation. Only after that check does a signed field subtract `256^w` once if its value is at least `(256^w)/2`. There is no additional lower-bound or digit-range check.

Thus an ordinary octet-valued seven- or eight-unit representation with its sign bit set is rejected before it can become a negative result: its unsigned value is at least `2^55` or `2^63`, respectively. For example, eight codepoints of value 255 read with `j` reach the safe-integer error rather than returning −1. Packing −1 with `j` is likewise not a promise of an exact all-255 representation: it first performs the Number addition `-1 + 2^64`.

### Text fields {#sec-bios-string-text-fields}

Text widths and lengths are codepoint counts. Embedded zero codepoints are ordinary String content except where `z` explicitly forbids or terminates them.

#### `cN`: fixed width {#sec-bios-string-cn-fixed-width}

`pack` copies the first `N` codepoints. It truncates longer input without error and pads shorter input with zero codepoints. There is no automatic field alignment.

`c0` still consumes one argument but performs no input-length operation and writes no field data.

`unpack` returns exactly the selected `N`-unit substring, including zero codepoints, then advances by `N`. On a String source, `c0` returns an empty String.

#### `z`: zero terminated {#sec-bios-string-z-zero-terminated}

`pack` scans the complete input. A zero codepoint anywhere in it causes `string.pack z strings must not contain zero bytes.` Otherwise it copies the content and appends one zero terminator. The error says “bytes”; the scan itself compares codepoints to zero.

`unpack` searches for the first zero codepoint, returns the preceding content, and advances past the terminator. If no terminator is found within the source, it reports the zero-terminated-string error.

#### `s[N]`: length prefixed {#sec-bios-string-sn-length-prefixed}

`pack` aligns the prefix, writes the content's codepoint count as an unsigned integer of the selected prefix width, then copies the entire content. The prefix uses the current endian order and the integer packing checks. Zero codepoints in the content are permitted.

`unpack` reads the unsigned prefix, checks that the indicated content span fits, returns exactly that span, and advances past both prefix and content. Zero codepoints are preserved.

`packsize` rejects both `z` and `s` immediately when it reaches them, regardless of any intended content.

### Floating-point fields {#sec-bios-string-floating-point-fields}

`f` uses a four-unit field; `d` and `n` use eight-unit fields. These are specific Number-to-field transformations. Use the transformations below, including their rounding and subnormal rules, when constructing an interchange record.

The following equations specify the transformations, including their subnormal branch. `//` denotes BLua floor division.

#### Encoding {#sec-bios-string-encoding}

Pass a Number. `f` encodes IEEE 754 binary32; `d` and `n` encode IEEE 754
binary64. Finite values are rounded to the nearest representable value, with
an exact halfway case selecting the even significand. Binary32 conversion
can therefore lose precision or overflow even when the original Number is
finite. Binary64 retains a finite Number's representation.

Subnormal results use gradual underflow. Positive and negative zero retain
their signs, including when a small value rounds to zero. Infinities retain
their signs. Number NaNs are written with exponent bits all set and fraction
1; their original payload and sign are not preserved.

| Input Number | Binary32 word | Binary64 high word | Binary64 low word |
| --- | --- | --- | --- |
| `0` | `00000000H` | `00000000H` | `00000000H` |
| `-0.0` | `80000000H` | `80000000H` | `00000000H` |
| `1.25` | `3FA00000H` | `3FF40000H` | `00000000H` |
| `2^-149` | `00000001H` | `36A00000H` | `00000000H` |
| `2^-1074` | `00000000H` | `00000000H` | `00000001H` |
| Positive infinity | `7F800000H` | `7FF00000H` | `00000000H` |
| NaN | `7F800001H` | `7FF00000H` | `00000001H` |

A binary32 field writes its word in the selected byte order. A little-endian
binary64 field writes the low word first, then the high word, with each word
little-endian. A big-endian binary64 field writes the high word first, then
the low word, with each word big-endian. Each output octet is held as one
String codepoint.

For decoding below, the field parameters are:

| Field | Exponent bits `E` | Mantissa bits `M` | Bias `B = 2^(E-1)-1` | Scale `S = 2^M` |
| --- | ---: | ---: | ---: | ---: |
| `f` | 8 | 23 | 127 | `2^23` |
| `d`, `n` | 11 | 52 | 1023 | `2^52` |

Let `emax = 2^E - 1`. These are field values, not additional format options.
The encoding operation does not parse numeric Strings or perform the integer
field's argument checks. Supply Number values rather than using packing as a
general value conversion.

#### Decoding {#sec-bios-string-decoding}

`f` reads one four-unit word as `high` and supplies `low = 0`. `d` and `n` read the two four-unit words in the inverse order of encoding.


The sign multiplier is −1 when `high >= 2^31`, otherwise 1. Extract the fields as follows:

```text
f:
    e = (high // 2^23) % 2^8
    m = high % 2^23

d, n:
    e = (high // 2^20) % 2^11
    m = (high % 2^20) * 2^32 + low
```



Using that field's `B`, `S`, and `emax`:

```text
e == emax and m == 0:  sign / 0
e == emax and m ~= 0:  0 / 0
e == 0:               sign * (m / S) * 2^(1 - B)
otherwise:            sign * (1 + m / S) * 2^(e - B)
```


Source digits are not validated as octets. NaN payloads are reduced to a Number NaN by the arithmetic above.

### Unpack positions, bounds, and results {#sec-bios-string-unpack-positions-bounds-and-results}

`pos` defaults to 1 when absent or nil. Otherwise `pos // 1` supplies the starting position; the zero-based offset is that result minus 1. Fractional finite Numbers therefore round down here. Negative positions are **not** relative to the source's end.

For an ordinary numeric starting position, the accepted interval is 1 through `#packet + 1`, inclusive. The final position can serve an empty/control-only or zero-width format, but cannot supply packet data. A position outside the interval causes `string.unpack start index out of range.`

Alignment remains relative to the absolute source offset. A packet packed at offset 0 is therefore not automatically aligned the same way when unpacked from an arbitrary interior position.

The position argument has no Number-category or integer check. A nonnumeric value or NaN becomes NaN through `//`, evades the range comparisons, and is not repaired. For example, an empty format and String source with a numeric String position produce NaN as the only next-position result. Either infinity fails the explicit range check.

Before reading or skipping `x`, `X`, integer, float, fixed-width text, length-prefix, or prefixed-content spans, `unpack` checks whether the needed span extends beyond the source. Such a failure reports `string.unpack string is too short.` The `z` scan instead has its own missing-terminator error. Earlier processing is not rolled back when a later field fails.

Successful unpacking need not consume the whole String: trailing content is allowed. The final result is the **next one-based codepoint position**, not the number of units consumed. It can be passed as the next call's `pos`, provided the desired absolute-offset alignment is retained:

```lua
local first, next_pos = string.unpack("<I2", packet)
local tag, after_tag = string.unpack("c4", packet, next_pos)
```


### Argument categories and library dependencies {#sec-bios-string-argument-categories-and-library-dependencies}

Use Strings for formats, text fields and input records. Length and
substring operations still obey their general language rules: `#` accepts
Tables as well as Strings, while `string.byte` requires a String. As a
result, these edge cases follow the operations selected by the format:

- A format Table whose length is zero bypasses token reads; a positive-length format Table reaches `string.byte` and fails its String requirement.
- `c0` can consume even an argument with no supported length operation, because it never requests that length.
- A Table input with length zero can supply padding to `cN`, an empty payload to `s`, or only the terminator to `z`.
- A substring covering an operand's entire span can return the original Table. Later concatenation then uses the current global `tostring` for it rather than necessarily producing an early String-category error.
- A Table source can pass through control/padding-only unpacking without byte access. A full-span `cN` substring can likewise return the Table itself.


These branches use the CPU's maintained-length rule.

Packing keeps its original character, substring, Table-concatenation,
Table-unpack and floating-word conversion functions. Argument selection reads
current `select` and reported errors call current `error`. A saved helper
continues to use any current globals required by that helper, including
`tostring` during singleton concatenation. Successful unpacking always
includes the next-position result, even for a format with no data fields.


### Errors {#sec-bios-string-errors}

The packing module directly reports the following messages, with the capitalization and punctuation shown. The shared format parser also uses `string.pack`-prefixed messages during `packsize` and `unpack`.

| Condition | Message |
| --- | --- |
| Integer input fails the integer-value test | `string.pack integer value must be an integer.` |
| Integer input exceeds the safe Number integer interval | `string.pack integer value exceeds safe integer range.` |
| Integer input does not fit its field width | `string.pack integer value out of range.` |
| Accumulated unsigned input exceeds the safe integer interval | `string.unpack integer exceeds safe integer range.` |
| Missing or nonpositive `!N` suffix | `string.pack alignment must be a positive integer.` |
| Explicit `i`/`I` width outside 1–8 | `string.pack invalid integer size.` |
| Missing `c` width | `string.pack expected a size for c format.` |
| Explicit `s` prefix width outside 1–8 | `string.pack invalid length size.` |
| Unsupported format option | `string.pack unsupported format option.` |
| Zero codepoint in a packed `z` input | `string.pack z strings must not contain zero bytes.` |
| `z` or `s` encountered by `packsize` | `string.packsize format is variable-length.` |
| Starting offset outside the source bounds | `string.unpack start index out of range.` |
| Required fixed or prefixed span does not fit | `string.unpack string is too short.` |
| No zero terminator found for `z` | `string.unpack zero-terminated string not found.` |


Length, character and substring failures retain their ordinary errors.
Formats are processed alongside their fields, including `X` lookahead, so a
later error can follow earlier reads, conversions and argument selections.

### Work and interface boundaries {#sec-bios-string-work-and-interface-boundaries}

Packet size and field kind determine the processing and temporary
language storage required. Integer fields convert their digits and
floating fields perform word conversion. Large fixed-width text fields
construct correspondingly large Strings.

Each `string.byte` or `string.char` invocation adds its two-cycle primitive
surcharge, in addition to the executed BIOS instructions and ordinary calls.
Use the CPU timing rules for the complete sequence.
