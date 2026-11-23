# BIOS String operations {#sec-bios-string}

Use `string` for text construction, character access, slicing, formatting,
pattern matching and formatted String records. Normal BIOS startup installs
the Table and registers it for String method lookup. Call `string.sub(text,
start, finish)` or the corresponding `text:sub(start, finish)` form.

## Byte strings and text {#sec-bios-string-text-values-and-encoded-byte-storage}

A String is an immutable sequence of bytes. It can contain any byte from
`00H` to `FFH`, including NUL and sequences that are not valid UTF-8. The
length and all positions in the String library count bytes. A String value is
not a bus address and does not alias a mapped source buffer.

Write ordinary text in a source literal to obtain its UTF-8 bytes. Numeric
escapes supply bytes directly: `'é'` and `'\xc3\xa9'` contain the same two
bytes, whereas `'\xe9'` contains one byte with value 233. To construct UTF-8
text from Unicode scalar values at run time, call `utf8.char` instead of
`string.char`.

## Example: byte positions and mapped input {#sec-bios-string-example-codepoints-and-mapped-utf-8}

```lua
rodata greeting: u8[4] = { 0x41, 0xc3, 0xa9, 0 }
local text = string.from_bytes(greeting, #greeting)
local length = #text                             -- 4 bytes
local lead = string.byte(text, 2)                -- 195
local tail = string.byte(text, 3)                -- 169
local same = text == utf8.char(65, 233, 0)        -- true
local raw = string.char(0xff, 0, 0x80)           -- valid String, not UTF-8
```

## Byte access, construction, length and mapped input {#sec-bios-string-codepoint-access-construction-length-and-utf-8-input}

### `string.byte(value, position)` {#sec-bios-string-stringbytevalue-position}

Returns one unsigned byte value. Positions start at 1. An omitted or nil
position selects position 1. A supplied Number is converted to a 32-bit word
and interpreted as a signed position. A position outside the String returns
one nil; negative positions do not count from the end. Non-String input and
invalid position operands raise an argument error. Additional arguments are
ignored.

### `string.char(...)` {#sec-bios-string-stringchar}

Constructs a String by converting each Number to an unsigned 32-bit word.
Every resulting word must be at most 255. The bytes appear in argument order;
with no arguments, the result is the empty String. Non-Number operands,
nonfinite Numbers and words outside the allowed byte range raise an argument
error. The primitive charges one cycle per supplied argument in addition to
its fixed call cost, including when conversion fails.

### `string.len(value)` {#sec-bios-string-stringlenvalue}

Applies the length operation. For a String, the result is its byte count,
including every NUL byte. It is not a Unicode character count.

### `string.from_bytes(address, byte_count)` {#sec-bios-string-stringfrom_utf8address-byte_count}

Copies a contiguous storage range into a String. Supply a 32-bit Integer
address and a nonnegative Integer byte count. An exactly integral Number in
range is also accepted for either argument. A zero count returns the empty
String without accessing memory. Otherwise, all requested bytes must exist in
one contiguous range of System ROM, program-accessible main RAM,
or ROM or RAM on the currently selected cartridge. Bytes beyond the end of
installed storage are not copied or filled with zeros. The operation does not
read I/O registers, private language storage, or across storage regions.
A bad argument or range faults with `Invalid argument.` before reading;
use the specified access width to read device registers. An admitted String
that cannot be stored is a memory error.

The bytes are copied in address order; no terminator is needed. Reuse of the
source memory does not alter the String. The copy completes or faults before
another guest instruction or interrupt is accepted; it does not yield between
bytes.

The operation adds two base cycles to the call cost. If the range is admitted,
it also adds one cycle per byte, even when the same String already exists or
an allocation fails. Result placement is charged separately.

#### Text projection {#sec-memory-text-codepoints-and-utf-8-bytes}

`utf8.char(...)` encodes Unicode scalar values as UTF-8 bytes. It rejects
Unicode surrogate values and values outside the Unicode range. Use
`utf8.read(text, position, last)` to read one scalar for display and obtain
the next byte position. Supply an in-range position and an inclusive last byte.
An invalid sequence produces the replacement character and advances one
byte; it does not change the underlying String. `utf8.count(text)` counts the
scalars produced by that display traversal.

## Case conversion, slicing, reversal and repetition {#sec-bios-string-case-conversion-slicing-reversal-and-repetition}

The contracts below describe the installed bindings. Each call returns exactly
one result when it completes. These functions do not write into their input.
For a String, positions and lengths count bytes, including zero bytes.

| Call | Operation on a String |
| --- | --- |
| `string.upper(value)` | Change ASCII `a`–`z` to `A`–`Z`; preserve every other byte. |
| `string.lower(value)` | Change ASCII `A`–`Z` to `a`–`z`; preserve every other byte. |
| `string.sub(value, start_arg, end_arg)` | Select the inclusive byte range described below. |
| `string.reverse(value)` | Reverse the byte order. |
| `string.rep(value, count_arg, separator)` | Repeat the value; a non-nil separator is placed between copies. |

### ASCII case conversion {#sec-bios-string-ascii-case-conversion}

`upper` subtracts 32 from codes 97 through 122. `lower` adds 32 to codes
65 through 90. Neither operation performs locale-sensitive conversion or
Unicode case folding.

```lua
local text = 'Azé🚀'
local capitals = string.upper(text) -- 'AZé🚀'
local small = string.lower(text)    -- 'azé🚀'
```

The result contains the mapped bytes in their original order. Empty
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
| Otherwise | One String containing the bytes from start through end, inclusive. |

A nonempty proper range of N bytes adds N cycles, in addition to
invocation and endpoint processing. The empty and whole ranges have no
per-byte charge.

```lua
local middle = string.sub('ABCDE', 2.9, 4.9) -- 'BCD'
local tail = string.sub('ABCDE', -2, nil)     -- 'DE'
local empty = string.sub('ABCDE', 0, 0)       -- ''
local whole = string.sub('ABCDE', nil, nil)  -- original value
```

Non-Number endpoint values raise `INVALID_ARGUMENT` in the floor division;
numeric-looking Strings are not parsed. A supplied Float NaN instead follows
the NaN row above. The length operation precedes normalization of the start
and end positions.

There is no preliminary String-only check here either. With a Table, the
empty-range branch can return an empty String and the full-span branch can
return that original Table. A nonempty proper range requires a String;
with a Table it raises `Invalid argument.` Other value kinds fail at
`#value`.

### Byte reversal {#sec-bios-string-codepoint-reversal}

`string.reverse` captures `L = #value`. If L is at most 1, it returns the original
value. Otherwise, it returns the bytes from positions L down to 1.

```lua
local backwards = string.reverse('ABC') -- 'CBA'
```

This reverses bytes, not Unicode scalars or grapheme clusters. It may produce a
String that is not valid UTF-8.

The early return also applies to a Table whose captured L is 0 or 1: the result
is that Table, not a String. With a Table whose L is greater than 1, the first
byte read raises `Invalid argument.` Other value kinds fail at the length
operation.

### Repetition and separators {#sec-bios-string-repetition-and-separators}

A missing or nil count means 1. Otherwise, the count is `count_arg // 1`;
a non-Number raises `INVALID_ARGUMENT` at that operation and is not parsed.
A count at most zero returns one empty String before the value or separator is
concatenated.

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
The String count `'3'` raises `INVALID_ARGUMENT`; it does not follow the NaN
rows. Those rows apply to a numeric Float NaN.

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

The byte-building paths above use captured `string.byte`, `string.char`
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

For a String `format`, positions, field widths and String precisions count bytes rather than Unicode characters. Literal bytes are copied in order. An embedded NUL does not terminate the format.

**Table-length dependency.** There is no String-only entry check: the first operation is `#format`. Categories other than String and Table fail at that operation. A Table whose length is obtained as zero returns an empty String; a positive length leads to a byte-read operation that requires a String and fails. The [CPU's Table-length rules](cpu.md#sec-cpu-table-length) also apply to the ordinary Table operations used during formatting.


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

`string.format('%.0f', 1000000)` returns `'1000000'`. Floating conversions
use the binary32 value; `%d` instead preserves every Integer digit.
For example, `string.format('%d/%.0f', 16777217, 16777217)` returns
`'16777217/16777216'`.

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

Decimal width and precision fields must fit a nonnegative Integer (at most
`2147483647`). A larger field raises an error instead of wrapping. There is no positional `$` syntax. No additional conversion is supplied for `a`, `A`, `p` or `n`; a percent reached after parsing flags, width or precision is not the `%%` escape.

Arguments are selected sequentially: width `*` first, precision `*` second, then one value for a recognized conversion. An unsupported conversion does not select a conversion value, although its stars have already selected their arguments. There is no argument-count preflight or too-many-arguments error. With the installed argument-selection function, an exhausted argument list supplies Nil to a scalar selection; an omitted `format` is also Nil.

A star takes a Number, truncates toward zero and requires the result to fit
an Integer. A negative width enables left alignment and uses its magnitude;
`-2147483648` cannot be used as a width because that magnitude is not an
Integer. A negative precision is absent. Nonfinite or out-of-range values
raise an error. Numeric text is not accepted in place of a Number.

### Flags, signs and padding {#sec-bios-string-flags-signs-and-padding}

Width is a minimum, never a truncation limit. Padding measures the combined byte lengths of sign, base prefix and content. If padding is needed, `-` appends spaces and overrides `0`. Otherwise `0` inserts zeros after the sign and base prefix; ordinary padding inserts spaces before both.

For signed integer conversions, a negative Integer selects `-`. Floating
conversions retain the sign of negative zero and negative infinity; NaN is
printed without a negative sign. Otherwise `+` selects `+`, then space
selects one leading space. Thus `+` overrides space.

| Conversion group | Flag and precision effects |
| --- | --- |
| `s`, `c`, `q` | Space padding only; `+`, space and `#` have no conversion effect. |
| `d`, `i` | Signed decimal; `+` and space select a nonnegative sign. `#` adds no prefix. |
| `u`, `o`, `x`, `X` | No sign from `+` or space. `#` affects octal and hexadecimal as described below. |
| All integers | Any present precision disables width zero-padding, including precision zero. |
| Floating conversions | Width zero-padding remains active when precision is present. `#` retains a point at zero precision in fixed/scientific construction and disables general-format zero stripping. |

### Text, byte and quoted conversions {#sec-bios-string-text-codepoint-and-quoted-conversions}

**`%s` — text.** Calls the current `tostring` on the argument, then, if precision is present, takes bytes 1 through that precision before applying width. For an ordinary converted String, precision zero gives empty content. The argument need not originally be a String. Substring construction uses the Table-length boundary rule above.

**`%c` — one byte.** Takes the integer component from `math.modf` and
passes that one value to `string.char`. Conversion to an unsigned 32-bit word
truncates and wraps. A word above `FFH` raises the argument error. NaN and either infinity raise `INVALID_ARGUMENT` at word
conversion; a non-Number raises an error in `math.modf` before reaching
`string.char`.

`string.format('%c', 0)` contains one NUL byte. Both
`string.format('%c', 65)` and `string.format('%c', 65.75)` produce `'A'`.
`string.format('%3c', 65)` produces two spaces followed by `'A'`. Precision is
ignored, although a precision star still consumes an argument.


**`%q` — quoted text.** Calls the current `tostring`, surrounds the resulting text with double quotes, and escapes its bytes as follows:

| Byte | Emitted escape |
| --- | --- |
| 10 | `\n` |
| 13 | `\r` |
| 9 | `\t` |
| 92, backslash | `\\` |
| 34, double quote | `\"` |
| Other values below 32, and 127 | Backslash followed by the decimal code, zero-padded to three digits. |


Every other byte is copied unchanged. Width applies after quoting. Precision is ignored, including after consuming a precision star. Because conversion to text happens first, `%q` is not a promise of round-trip serialization of the original value.

### Integer conversions {#sec-bios-string-integer-conversions}

`%d` and `%i` accept an Integer or a finite Float whose truncation toward
zero fits an Integer. They print signed decimal, including the full range
`-2147483648` through `2147483647`. A non-Number, nonfinite value or
out-of-range truncated value raises an error.

`%u`, `%o`, `%x` and `%X` admit the argument in the same way, then interpret
its 32 bits as an unsigned word. `%u` uses decimal, `%o` octal, and `%x`/`%X`
hexadecimal with lowercase/uppercase letters. Thus Integer `-1` prints as
`4294967295`, `37777777777`, `ffffffff` or `FFFFFFFF`, respectively. There
is no intermediate positive Number representing `2^32 - 1`.

Integer precision adds leading zeros to the requested minimum digit count.
Precision zero clears the digits when the word is zero. For `#` octal,
empty digits are restored to one `0`; otherwise a leading `0` is added only
if the first digit is not already zero. For `#` hexadecimal, `0x` or `0X`
is added only for a nonzero word. The common width rules then place sign,
prefix and padding.

### Floating conversions {#sec-bios-string-floating-conversions}

`f`/`F` select fixed decimal, `e`/`E` scientific notation, and `g`/`G` general
notation. An Integer argument is first rounded to Float. A Float argument
keeps its binary32 value. Numeric Strings and other non-Numbers raise an
error; they are not parsed as numeric text.

Finite values are rounded from their exact stored binary32 value to the
requested decimal position. Rounding chooses the nearest value, with an
exact half rounded away from zero. For example, `%.1f` formats `1.25` as
`1.3` and `-1.25` as `-1.3`. Precision can exceed the significant decimal
digits of a Float: subsequent digits describe that stored value, not the
original source numeral.

**Fixed (`f`, `F`).** Precision defaults to six and specifies the number of
digits after the decimal point. Precision zero omits the point unless `#`
is present. Large whole parts are written in full, not scientific notation.

**Scientific (`e`, `E`).** Precision defaults to six and specifies the
number of digits after the decimal point. A nonzero mantissa has one digit
before the point. Rounding a mantissa through ten increments the exponent.
The suffix is `e` or `E`, an explicit sign and at least two decimal exponent
digits. Zero has exponent zero. Precision zero omits the point unless `#`
is present.

**General (`g`, `G`).** Precision defaults to six significant digits;
explicit zero means one. First round to that number of significant digits.
Use scientific notation if the resulting exponent is below -4 or at least
the significant-digit count; otherwise use fixed notation. Without `#`,
omit trailing fractional zeros and an unneeded point. Integer place zeros
are never stripped: `%g` of `100000` is `100000`, not `1`. With `#`, retain
the requested significant digits and the decimal point.

NaN is `nan` or `NAN`; infinity is `inf` or `INF`. Negative infinity and
negative zero retain their minus sign; sign flags apply to other values,
including NaN. Width and zero-padding apply after constructing this text.

Numeric conversions produce their own decimal digits, independently of
replacing the global `tostring`. The `%s` and `%q` conversions still call
that global as specified above.

### Errors, completed work and limits {#sec-bios-string-errors-completed-work-and-limits}

With the installed `error`, an incomplete conversion raises the String:

```text
string.format incomplete format specifier.
```

This includes a final bare `%`, a final dot, and a conversion that ends after its flags, fields or ignored modifiers. An unsupported conversion raises `string.format unsupported format specifier '%C'.`, where `C` is replaced by that actual byte, not restricted to ASCII.


The formatter processes conversions in order. An error can occur after
earlier argument selections or conversions; the call returns no partial
String or count. Length and byte errors retain their ordinary texts.


The formatter keeps its original character, substring, repetition,
concatenation and numeric conversion functions. Its `%s`/`%q` `tostring`,
`select` and `error` calls use current globals. Replacing a saved helper's public field leaves
the saved function in place; that helper can still use current globals of its
own.

Choose widths and precisions appropriate to the output. Large padding and
decimal precision require more text storage and processing; they remain
subject to the language-storage budget. A field or numeric result length
that exceeds the nonnegative Integer range raises an error. No partial
result is returned.

## Pattern language {#sec-bios-string-pattern-language}

Patterns examine bytes, not Unicode scalars or grapheme clusters. Positions are byte positions. Character classes are ASCII classes; they do not expand to Unicode categories or locale-dependent character groups.

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

### Single-byte atoms and escapes {#sec-bios-string-single-codepoint-atoms-and-escapes}

An ordinary character matches the same byte. A dot, `.`, matches any available byte, including a newline. An escaped punctuation character matches that punctuation literally: for example, `%.` denotes a literal dot.


The named classes are:

| Class | Members |
| --- | --- |
| `%a` | ASCII `A`–`Z` and `a`–`z` |
| `%c` | Bytes at most 31, and byte 127 |
| `%d` | `0`–`9` |
| `%g` | Bytes 33–126 |
| `%l` | `a`–`z` |
| `%p` | Bytes 33–47, 58–64, 91–96, and 123–126 |
| `%s` | Space and bytes 9–13 |
| `%u` | `A`–`Z` |
| `%w` | ASCII letters, digits, and underscore |
| `%x` | `0`–`9`, `A`–`F`, and `a`–`f` |
| `%z` | Byte 0 |


Every uppercase ASCII letter following `%` complements the match for its lowercase letter. This rule is not restricted to the named classes: `%D` matches a non-digit, while `%Q` matches anything except lowercase `q`. An otherwise unrecognised nonuppercase escape matches its token literally; `%q` matches `q`, and `%0` matches `0`. Outside bracket sets, `%b`, `%f`, and `%1` through `%9` instead introduce the special constructs described below.

The character `|` does not introduce alternation. Braces do not introduce counted repetition, and backslash is not the pattern escape character. The characters `*`, `+`, `-`, and `?` act as repetition suffixes only when examined immediately after an ordinary atom. When encountered as a new atom, one of these characters is literal and can itself have a following repetition suffix.

The ordinary single-character check rejects positions beyond the source length, but does not itself reject positions below 1. A search begun sufficiently far below the first byte therefore follows below-range byte reads and String substring indexing; it does not acquire an implied lower clamp or a guarantee of ordinary 1-based matching boundaries.

### Bracket sets {#sec-bios-string-bracket-sets}

A bracket set, `[...]`, is an ordinary one-byte atom. A `^` immediately after `[` negates membership. The set scanner skips `%` and its following position, and the first other `]` closes the set. An unescaped `]` closes it even when it would be the first member. Write `%]` to include a literal closing bracket.

Inside a set, escapes use the class rules above. Named classes, uppercase complements, and escaped literals are available. The outside-set constructs are not available there: `%b` and `%f` mean literal `b` and `f`, and `%1` means literal `1`.

A range is recognised when an unescaped, single-item left member is followed by `-`. Its right endpoint must also parse as one item for range membership to match. Endpoints are compared as numeric bytes, inclusively; reversed endpoints match nothing. An escaped endpoint does not form an ordinary byte range. A right-side escape can be consumed without contributing range membership.

Do not assume a final hyphen is literal. The range scanner can take the set's closing `]` as the right endpoint. Write `%-` when literal hyphen membership is required.

An unescaped `[` encountered while set membership is traversed is itself passed to the bracket-item parser. This can skip subsequent text; it is not a nested-set union operation. Write `%[` for literal opening-bracket membership.

An empty positive set matches nothing. An empty negated set matches any available source byte. A reached `[` without an unescaped closing `]` raises `invalid string pattern`.

### Anchors and search order {#sec-bios-string-anchors-and-search-order}

Only a `^` at the first pattern position is an anchor. It is removed before matching and restricts the search to its supplied starting position. It does not independently assert the absolute beginning of the String. In repeated matching or substitution, it restricts each search to that operation's current search position. A `^` elsewhere is literal, except for set negation immediately after `[`.

Only a `$` at the final pattern position is an end anchor. It succeeds exactly when the current position is one past the source's last byte. A `$` elsewhere is literal.

Without a leading `^`, candidate starts are tried in increasing order, through the position one past the source end. The first successful candidate wins. Capture bookkeeping starts afresh for each candidate. The search does not silently switch to literal searching merely because a pattern looks literal.

### Greedy and minimal repetition {#sec-bios-string-greedy-and-minimal-repetition}

Repetition applies to ordinary single-byte atoms, including bracket sets and ordinary escaped classes.

| Suffix | Matching order |
| --- | --- |
| `?` | Try one occurrence, then zero |
| `*` | Greedy zero or more: try the longest span first, then shorter spans |
| `+` | Require one occurrence, then greedily expand the remainder |
| `-` | Minimal zero or more: try the remaining pattern first, then consume another byte if needed |

These choices depend on whether the rest of the pattern succeeds. Greedy matching can retreat from its longest span; minimal matching can grow beyond an empty span.

Capture delimiters, balanced matching, frontier matching, and backreferences take their own matching branches before repetition suffixes are considered. They cannot be repeated as groups or special constructs. A following `*`, `+`, `?`, or `-` is processed separately as an ordinary atom, not as repetition of that preceding construct. There is no alternation or counted-repeat construct.

### Captures and backreferences {#sec-bios-string-captures-and-backreferences}

An opening `(` records the current source position. A closing `)` searches backwards for the most recent capture entry whose finish is still unset and records its finish at the current position. A text capture is extracted from its recorded start through one byte before its finish. Capture entries are created in opening order.

The form `()` is different: it records the numeric current position without consuming text. It is a position capture, not an empty text capture.

**Capture-result dependency.** Capture bookkeeping and extraction use the [CPU's Table-length rules](cpu.md#sec-cpu-table-length). Returned sequences also follow the ordinary caller's result adjustment.

Outside sets, `%1` through `%9` refer to a previously recorded, finished text capture. A backreference compares that capture's bytes at the current source position and, on success, advances by the captured length. A missing capture, an unfinished capture, or a position capture raises `invalid string pattern capture` when that reference is reached.

A backreference has exactly one digit. `%10` is `%1` followed by literal `0`; it is not a reference to capture 10. Capture creation has no pattern-local count guard, but the backreference notation still names only entries 1 through 9.

A reached `)` raises `invalid string pattern` if the backwards search finds no entry with an unset finish. That search tests only the finish field; it does not exclude position-capture entries. Structurally odd combinations of position captures and closing parentheses therefore follow that same procedure, rather than a separate balanced-parenthesis validity rule.

Reaching the pattern end does not check for unfinished opening captures. If such a capture is later extracted, extraction computes its finish minus one even though the finish is unset. There is no dedicated unclosed-capture error at pattern end.

### Balanced regions {#sec-bios-string-balanced-regions}

The form `%bxy` requires the current source byte to be `x`. It scans forwards with an iterative depth counter, increasing depth for nested `x` and decreasing it for `y`. When a closing `y` reduces depth to zero, matching continues just after that closing byte and after the four-byte `%bxy` construct in the pattern. A different starting byte, or failure to find a closing delimiter, makes this match fail.

The closing-delimiter comparison is performed before the opening-delimiter comparison. This order also applies when `x` and `y` are the same byte.

There is no dedicated preliminary check that both delimiter positions exist. An incomplete `%b` construct proceeds through two String delimiter reads and then the balance scan.

### Frontiers {#sec-bios-string-frontiers}

The form `%f[set]` is zero-width. It requires the preceding byte not to belong to the set and the current byte to belong to it. The preceding value is byte 0 when the current position is at most 1; otherwise it is read from the preceding String position. The current value is read from the String when the position is at most the source length; otherwise it is byte 0. The read applies the signed-32 position conversion of `string.byte`. A converted position below 1 returns `nil`, not byte 0. These values take part in the ordinary set-membership test.

The `[` must immediately follow `%f`; otherwise a reached frontier construct raises `invalid string pattern`. Its set uses the same scanner, membership rules, and missing-closing-bracket error as an ordinary bracket set. A successful frontier consumes no source byte.

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

A terminal `%` has no dedicated rejection. Special-escape dispatch first reads a missing token; the ordinary item scan then advances by two pattern positions. If single-byte matching is reached, a source position greater than the String length fails before class matching; otherwise class matching receives the missing escape token. Numeric comparisons reached with that missing token are false. Incomplete balanced constructs, unfinished captures and odd capture closures follow their respective operations above rather than a separate syntax-validation pass.

## Pattern searches and substitutions {#sec-bios-string-pattern-searches-and-substitutions}

Pattern calls return positions, captured substrings or replacement text as
specified below. Capture and result sequences use ordinary Table lengths and
ordinary call-result adjustment. The [CPU reference](cpu.md#sec-cpu-table-length)
defines those rules. Matching and substitution also allocate temporary
language objects; budget for them when processing large text.

### `string.find` {#sec-bios-string-stringfind}

```text
string.find(source, pattern [, start [, plain]])
```

Searches `source` and constructs the start and inclusive end positions of the first match. Positions count String bytes, beginning at 1; they are neither UTF-8 byte offsets nor grapheme-cluster positions. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax, capture ordering and position captures.

**Arguments and starting position.** Omitted or nil `start` means 1. Otherwise the function computes `start // 1`: a positive result is used directly, a negative result becomes `#source + result + 1`, and zero or Float NaN becomes 1. A result still below 1 is not clamped. Do not rely on such a start producing ordinary in-range match boundaries. This arithmetic does not parse numeric Strings; a nonnil non-Number raises `INVALID_ARGUMENT`.

If the normalized start is greater than `#source`, `find` returns one nil before inspecting `plain` or the pattern. In particular, a start of `#source + 1` takes this return, even for an empty pattern. Otherwise a pattern search can consider candidates through `#source + 1`. A leading `^` restricts the search to the supplied start; it does not independently assert the beginning of the complete source.

**Literal search.** A truthy `plain` selects literal byte comparison instead of the pattern language. Only nil and false disable this option: 0 and the empty String enable it. An empty literal needle constructs `(start, start - 1)` after the initial bound check above. A nonempty needle searches candidate positions in increasing order and constructs the first start/inclusive-end pair; failure returns one nil. Literal search does not interpret captures or any other pattern syntax.

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

Searches for the first pattern match, using the byte positions, start normalization, binding dependencies and reached-error rules described under `string.find`. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax.

The default start is 1. A nonnil start is processed with `// 1`, negative positions are relative to the end, zero becomes 1, and an excessively negative result is not clamped. Unlike `find`, `match` does not first reject a start greater than `#source`; its search considers candidates from the supplied start through `#source + 1`. A leading `^` restricts it to the supplied start.

Failure returns one nil. On success, `match` builds a result sequence containing the whole matched substring if there are no captures, or the capture values in opening order otherwise. Substring captures are Strings; position captures are Numbers. It expands that sequence into return values, without adding start/end positions.

There is no plain-search argument. Surplus arguments are ignored, rather than selecting a different search mode.


### `string.gmatch` {#sec-bios-string-stringgmatch}

```text
string.gmatch(source, pattern)
```

Returns one iterator function. The outer call captures `source` and `pattern` and initializes its search position to 1; it does not inspect either input or parse the pattern before returning. It does not return separate state and control values. Surplus outer-call arguments are ignored.


Call the returned function with no arguments; any supplied arguments are ignored. Each call searches from its current byte position. Success constructs and expands the same result sequence as `string.match`: the whole match when there are no captures, otherwise capture values in opening order. Failure returns one nil.

After a nonempty match, the next search starts at the match's exclusive end. After an empty match, it starts one position beyond that exclusive end. The search position changes before capture extraction and return-value construction, so an error during those operations can occur after the iterator has advanced. A failed search leaves the position unchanged; there is no latched finished state, and another call repeats that failed search.

A leading `^` applies at each current search position, not just at the absolute beginning of `source`. The iterator does not search for overlapping nonempty matches inside a span it has already consumed. See [Pattern language](#sec-bios-string-pattern-language) for the matching rules and `string.find` for shared bindings and reached errors; those errors are deferred until an iterator call reaches the relevant operation.

One iterator call performs one complete search, which can examine all remaining candidate positions and backtrack.

### `string.gsub` {#sec-bios-string-stringgsub}

```text
string.gsub(source, pattern, replacement [, limit])
```

Builds a substituted String and returns it together with the substitution count. Positions and substring boundaries are byte-based. See [Pattern language](#sec-bios-string-pattern-language) for pattern syntax and `string.find` for shared binding dependencies and reached pattern errors.

**Limit and count.** Omitted or nil `limit` means `#source + 1`. Otherwise the function computes `limit // 1` and replaces a negative result with 0. A zero limit skips matching and replacement entirely, assembles the unchanged source tail, and returns that String with count 0. A nonnil non-Number limit raises `INVALID_ARGUMENT` in the floor division; it is not parsed as a numeric String. A Float NaN is a Number and fails the loop comparison, so the replacement loop is skipped.

The count increases after a successful replacement evaluation, including an evaluation that chooses to keep the original match. The limit bounds completed replacement iterations, not the work spent finding a match, backtracking, looking up a replacement or running a replacement function.

**Replacement arguments.** For each match, the function constructs a replacement-argument sequence: the whole matched substring when there are no explicit captures, otherwise capture values in opening order. Substring captures are Strings and position captures are Numbers. The whole match remains separately available to the replacement rules below.

- **String or Number:** first convert the replacement with the retained `tostring`, then parse its text. Ordinary bytes copy literally. `%%` emits `%`; `%0` emits the whole match. For another byte following `%`, the retained `tonumber` is used: a numeric result selects that numbered replacement-argument entry, and a missing entry contributes an empty String; a nonnumeric token is emitted without the `%`. A final lone `%` is copied literally. Consequently `%1` refers to the whole match when there are no captures. Numeric position-capture values reach the output conversion as Numbers.
- **Table:** use the first replacement argument as the key when the argument sequence has entries, otherwise use the whole match. This is an ordinary table lookup. Its metatable lookup follows Table-valued `__index` chains; it does not call a Function-valued `__index`. A nil result keeps the whole match. Every other result, including false, is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.
- **Function:** pass the replacement arguments separately when their sequence has entries, otherwise pass the whole match. Only the first return value is used. Nil or false keeps the whole match; any truthy value is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.

A replacement of any other kind raises exactly `string.gsub replacement must be a string, number, function, or table.` only when a match reaches replacement evaluation. A zero limit or an unsuccessful search does not prevalidate the replacement.

**Search advancement and assembly.** Searching begins at position 1. For each match, the function appends the unmatched prefix and the evaluated replacement. A nonempty match moves both the next search position and the beginning of the remaining source tail to the match's exclusive end; it does not search for overlaps inside the consumed span.

For an empty match, after replacement evaluation the function first checks the *previous* search position. If that position is already greater than `#source`, it stops. Otherwise it sets both the next search position and the remaining-tail position to one position beyond the empty match's exclusive end. This advances past a source position without appending that position's byte. An empty match immediately after a nonempty match is not automatically suppressed.

After substitution stops, the remaining source tail is appended and the output pieces are concatenated. A leading `^` is applied at every current search position, not as a one-time absolute-source-beginning restriction.

A replacement function's effects remain visible if a later match or operation
fails. An error ends `gsub` without returning a partial output or count. The
match count advances after replacement evaluation returns. The substitution
limit does not bound output size or matching work.

## Floating-point word decoder {#sec-bios-string-floating-point-word-decoder}

The named BIOS import `string/float/decode` binds a static call target,
not a runtime library Table or a first-class function value:

```lua
local decode_float<const> = require('string/float/decode')
local sample = decode_float(0x3fa00000, 0, 4)        -- 1.25
local calibration = decode_float(0xc0040000, 0, 8)  -- -2.5
```

Its signature is `decode_float(high, low, byte_count)`, with one Float result.
Pass Integers containing the raw words after reading them in the record's byte
order; their signed interpretations do not change their bits:

| Argument | Four-byte form | Eight-byte form |
| --- | --- | --- |
| `high` | Complete 32-bit field | High 32 bits, containing sign and exponent |
| `low` | Unused; conventionally 0 | Low 32 bits |
| `byte_count` | 4 | 8 |

Exactly `byte_count == 4` selects the four-byte form; every other value selects
the eight-byte calculation. The words used by the selected form undergo the
integer conversion of the CPU's bitwise instructions. Both forms use the field extraction under
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
collections use the [CPU's Table-length rules](cpu.md#sec-cpu-table-length),
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

The packet contains bytes 1, 2, 66, 77, 83, 88. Its size is 6; unpacking returns 513, 'BMSX', then next position 7.

### Packet units are bytes {#sec-bios-string-packet-units-are-string-codepoints}

Packed Strings contain explicit byte sequences. Text fields copy bytes without
interpreting their encoding; numeric fields read or write unsigned byte
digits in the selected endian order. Positions and alignment use byte
offsets. The result is a String, not a mapped byte buffer or an address.

### Example: a packed record {#sec-bios-string-example-a-packed-record}

The format below combines a fixed header, a length-prefixed payload and a
zero-terminated status. Maximum alignment 4 places the eight-unit `d` field at
offset 12 rather than 16. The payload's zero byte is content in `s1`;
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
position 24. The second call returns the three-byte payload, `'ready'`,
then position 34. These are one-based continuation positions, not lengths.

| Zero-based offset | Field | Packet bytes |
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

Only the following whitespace is ignored between format tokens: space and bytes 9–13. A numeric suffix consists of consecutive ASCII decimal digits. There is no sign, decimal point, separator, or internal whitespace in a suffix. Leading zeroes do not impose a digit-count limit. The mathematical suffix
value must fit a nonnegative Integer (0 through 2147483647); a larger value
raises `string.pack format count out of range.` Individual options below
impose their further restrictions.


In the tables, `A` is the current maximum alignment, and all widths and alignments count packet units. Defaults are fixed, not inferred from a machine word size.

| Option | Field | Width | Alignment | Arguments / data results |
| --- | --- | ---: | --- | --- |
| `b` | Signed integer | 1 | `min(A, 1)` | 1 / 1 |
| `B` | Unsigned integer | 1 | `min(A, 1)` | 1 / 1 |
| `h` | Signed integer | 2 | `min(A, 2)` | 1 / 1 |
| `H` | Unsigned integer | 2 | `min(A, 2)` | 1 / 1 |
| `l` | Signed integer | 4 | `min(A, 4)` | 1 / 1 |
| `L` | Unsigned integer | 4 | `min(A, 4)` | 1 / 1 |
| `j` | Signed Integer | 4 | `min(A, 4)` | 1 / 1 |
| `J` | Unsigned Integer word | 4 | `min(A, 4)` | 1 / 1 |
| `i[N]` | Signed integer | `N`, default 4; explicit `N` must be 1–8 | `min(A, N)` | 1 / 1 |
| `I[N]` | Unsigned integer | `N`, default 4; explicit `N` must be 1–8 | `min(A, N)` | 1 / 1 |
| `T` | Unsigned integer | 4 | **4, regardless of `A`** | 1 / 1 |
| `f` | Floating-point field | 4 | `min(A, 4)` | 1 / 1 |
| `d` | Floating-point field | 8 | `min(A, 8)` | 1 / 1 |
| `n` | Floating-point field | 4 | `min(A, 4)` | 1 / 1 |
| `cN` | Fixed-width text | `N`; suffix required, zero permitted | 1; no automatic padding | 1 / 1 |
| `z` | Zero-terminated text | Content length + 1 | 1 | 1 / 1 |
| `s[N]` | Length-prefixed text | Prefix width + content length; prefix defaults to 4, explicit width 1–8 | `min(A, prefix width)` before the prefix | 1 / 1 |
| `x` | Padding | 1 | No additional alignment | 0 / 0 |
| `X` | Align for a following field | Padding only; see below | Determined by lookahead | 0 / 0 |


`[N]` marks an optional suffix in this table; the square brackets are not format characters. The `f`, `d`, `n`, and `z` options do not read a width suffix. `cN` uses the full nonnegative Integer width range.

| Control | Effect |
| --- | --- |
| `<` | Select little-endian numeric order. |
| `>` | Select big-endian numeric order. |
| `=` | Select the fixed default: little-endian order. |
| `!N` | Set maximum alignment to positive decimal `N`. The suffix is required. It need not be a power of two; the maximum is 2147483647. |

Controls consume neither packet units nor arguments and return no data values. Every other option is unsupported. Parsing and field processing are interleaved; there is no separate up-front format-validation pass.

#### Alignment and padding {#sec-bios-string-alignment-and-padding}

Before an aligned field, padding is calculated from the current zero-based offset:

```text
padding = 0                                      when alignment <= 1
padding = (alignment - offset % alignment) % alignment   otherwise
```

Offsets include all earlier fields and padding. In `unpack`, alignment uses the absolute source offset, including the starting position; it does not begin a new alignment origin at the selected subrecord. No call adds implicit final record padding.

`pack` writes zero bytes for all padding. `unpack` checks that skipped padding fits within the source but does not inspect its contents. Padding need not contain zero to be accepted.

`X` looks ahead to find an alignment without consuming the following field. Its lookahead skips `x`, further `X` options, and endian/alignment controls, while tracking the controls' future state locally. The main parser still processes all those options later. The chosen alignment is:

- an integer field's alignment, including the fixed alignment 4 for `T`;
- a floating-point field's alignment;
- an `s` field's prefix alignment;
- the full width `N` for `cN`, **not** 1 and not a width limited by `A`;
- 1 for `z` or the end of the format.

For example, `string.packsize("!1bT")` is 8, and `string.packsize("bXc3")` is 6. A trailing `X` adds no padding.

### Integer fields {#sec-bios-string-integer-fields}

Packing accepts an Integer or a Float whose exact integral value fits the
signed 32-bit Integer range. A fraction, nonfinite Float or nonnumeric value
raises an error. The resulting Integer supplies a 32-bit word.

For a signed field narrower than four units, the Integer must fit its signed
field width. For an unsigned field narrower than four units, it must be
nonnegative and fit that field width. Fields of four or more units accept every
Integer. Signed fields wider than four units extend the sign bit; unsigned
fields wider than four units extend with zero bits. Exactly the selected number
of base-256 digits is written in the selected order. For example,
`string.pack("<I4", -1)` writes four bytes of value 255, while
`string.pack("<I2", -1)` raises an unsigned-range error.

For unpacking, accumulate the bytes in the selected order as a mathematical
nonnegative integer `N`. Let `W = 2^(8 * width)`. For a signed field, if
`N >= W / 2`, subtract `W`; the resulting value must fit the signed 32-bit
Integer range. An unsigned field may be at most `FFFFFFFFH`; its low 32 bits
become an Integer, including a negative Integer when bit 31 is set. Values
outside these ranges raise an error.

Thus four bytes of value 255 unpacked as either `j` or `J` produce
Integer −1. Eight such bytes unpacked with `i8` produce Integer −1,
while `I8` raises an error because its unsigned value exceeds 32 bits. No
64-bit Integer subtype is created by an eight-unit field.

### Text fields {#sec-bios-string-text-fields}

Text widths and lengths are byte counts. Embedded zero bytes are ordinary String content except where `z` explicitly forbids or terminates them.

#### `cN`: fixed width {#sec-bios-string-cn-fixed-width}

`pack` copies the first `N` bytes. It truncates longer input without error and pads shorter input with zero bytes. There is no automatic field alignment.

`c0` still consumes one argument but performs no input-length operation and writes no field data.

`unpack` returns exactly the selected `N`-unit substring, including zero bytes, then advances by `N`. On a String source, `c0` returns an empty String.

#### `z`: zero terminated {#sec-bios-string-z-zero-terminated}

`pack` scans the complete input. A zero byte anywhere in it causes `string.pack z strings must not contain zero bytes.` Otherwise it copies the content and appends one zero terminator.

`unpack` searches for the first zero byte, returns the preceding content, and advances past the terminator. If no terminator is found within the source, it reports the zero-terminated-string error.

#### `s[N]`: length prefixed {#sec-bios-string-sn-length-prefixed}

`pack` aligns the prefix, writes the content's byte count as an unsigned integer of the selected prefix width, then copies the entire content. The prefix uses the current endian order and the integer packing checks. Zero bytes in the content are permitted.

`unpack` reads the unsigned prefix, checks that the indicated content span fits, returns exactly that span, and advances past both prefix and content. Zero bytes are preserved.

`packsize` rejects both `z` and `s` immediately when it reaches them, regardless of any intended content.

### Floating-point fields {#sec-bios-string-floating-point-fields}

`f` and `n` use four-unit binary32 fields; `d` uses an eight-unit binary64
field. These are specific Number-to-field transformations. Use the
transformations below, including their rounding and subnormal rules, when
constructing an interchange record.

The following equations describe mathematical field values, including the subnormal branch. They are not BLua expressions; `//` denotes mathematical floor division and raw words are interpreted as unsigned field bits.

#### Encoding {#sec-bios-string-encoding}

Pass a Number. `f` and `n` encode IEEE 754 binary32; `d` encodes IEEE 754
binary64. Integer-to-binary32 conversion rounds to the nearest representable
value, with an exact halfway case selecting the even significand. A Float
already has binary32 precision. Encoding either an Integer or a finite Float
as binary64 preserves its exact numerical value.

Subnormal results use gradual underflow. Positive and negative zero retain
their signs, including when a small value rounds to zero. Infinities retain
their signs. A Float encoded as binary32 retains its entire word, including
NaN sign and payload. A NaN encoded as binary64 becomes the quiet NaN with
high word `7FF80000H` and low word zero.

| Input Number | Binary32 word | Binary64 high word | Binary64 low word |
| --- | --- | --- | --- |
| `0` | `00000000H` | `00000000H` | `00000000H` |
| `-0.0` | `80000000H` | `80000000H` | `00000000H` |
| `1.25` | `3FA00000H` | `3FF40000H` | `00000000H` |
| `2^-149` | `00000001H` | `36A00000H` | `00000000H` |
| Positive infinity | `7F800000H` | `7FF00000H` | `00000000H` |
| Canonical arithmetic NaN | `7FC00000H` | `7FF80000H` | `00000000H` |

A binary32 field writes its word in the selected byte order. A little-endian
binary64 field writes the low word first, then the high word, with each word
little-endian. A big-endian binary64 field writes the high word first, then
the low word, with each word big-endian. Each output octet is held as one
String byte.

For decoding below, the field parameters are:

| Field | Exponent bits `E` | Mantissa bits `M` | Bias `B = 2^(E-1)-1` | Scale `S = 2^M` |
| --- | ---: | ---: | ---: | ---: |
| `f`, `n` | 8 | 23 | 127 | `2^23` |
| `d` | 11 | 52 | 1023 | `2^52` |

Let `emax = 2^E - 1`. These are field values, not additional format options.
The encoding operation does not parse numeric Strings or perform the integer
field's argument checks. Supply Number values rather than using packing as a
general value conversion.

#### Decoding {#sec-bios-string-decoding}

`f` and `n` read one four-unit word as `high` and supply `low = 0`. `d` reads
the two four-unit words in the inverse order of encoding. Every result is a
Float. A binary32 field preserves all its bits. A finite binary64 value is
rounded directly to binary32, to nearest with ties to even, after both words
have been read; a binary64 NaN becomes `7FC00000H`.


The sign multiplier is −1 when bit 31 of the raw `high` word is set, otherwise
1. Extract the fields as follows; these equations describe the field bits and
do not require a signed Number holding a 64-bit mantissa:

```text
f, n:
    e = (high // 2^23) % 2^8
    m = high % 2^23

d:
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


The encoded bytes are read as fixed-width words in the selected endian order. Binary64 NaN payloads are reduced to a canonical Float NaN. The formulas identify the value represented by the input field; for a
binary64 field the final rounding is to binary32, not to a binary64 Number.

### Unpack positions, bounds, and results {#sec-bios-string-unpack-positions-bounds-and-results}

`pos` defaults to 1 when absent or nil. Otherwise `pos // 1` supplies the starting position; the zero-based offset is that result minus 1. Fractional finite Numbers therefore round down here. Negative positions are **not** relative to the source's end.

For an ordinary numeric starting position, the accepted interval is 1 through `#packet + 1`, inclusive. The final position can serve an empty/control-only or zero-width format, but cannot supply packet data. A position outside the interval causes `string.unpack start index out of range.`

Alignment remains relative to the absolute source offset. A packet packed at offset 0 is therefore not automatically aligned the same way when unpacked from an arbitrary interior position.

A nonnumeric position, NaN or infinity raises an error. A finite fractional
position follows the floor rule above before the range check; a numeric String
is not parsed as a position.

Before reading or skipping `x`, `X`, integer, float, fixed-width text,
length-prefix, or prefixed-content spans, `unpack` checks whether the needed
span extends beyond the source. Such a failure reports
`string.unpack string is too short.` The `z` scan instead has its own
missing-terminator error. A later field error leaves earlier processing
effects in place.

Successful unpacking need not consume the whole String: trailing content is allowed. The final result is the **next one-based byte position**, not the number of units consumed. It can be passed as the next call's `pos`, provided the desired absolute-offset alignment is retained:

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


These branches use the CPU's Table-length boundary rule.

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
| Integer input does not fit its field width | `string.pack integer value out of range.` |
| Decoded integer is outside the signed-result or unsigned-word range | `string.unpack integer exceeds safe integer range.` |
| A decimal format suffix exceeds the nonnegative Integer range | `string.pack format count out of range.` |
| The total returned by `packsize` exceeds 2147483647 | `string.packsize size out of range.` |
| A floating field input is not a Number | `string.pack float value must be a number.` |
| Missing or nonpositive `!N` suffix | `string.pack alignment must be a positive integer.` |
| Explicit `i`/`I` width outside 1–8 | `string.pack invalid integer size.` |
| Missing `c` width | `string.pack expected a size for c format.` |
| Explicit `s` prefix width outside 1–8 | `string.pack invalid length size.` |
| Unsupported format option | `string.pack unsupported format option.` |
| Zero byte in a packed `z` input | `string.pack z strings must not contain zero bytes.` |
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
