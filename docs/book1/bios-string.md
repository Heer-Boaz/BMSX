# BIOS String operations

The installed BIOS supplies the `string` global before cartridge entry. The
nine base operations construct text, select codepoints, change ASCII case,
take substrings, reverse or repeat values, and decode a mapped UTF-8 byte span.
The separate `string.format` interface builds formatted text. No cartridge
import is required for these installed operations. Pattern matching and binary
packing remain separate interfaces, not additional modes of the base operations.

## Text values and encoded byte storage

A String is a language value, not a numeric address of its characters. Its
length counts codepoints. Despite its name, `string.byte` selects one complete
codepoint; it is not a load from encoded byte storage. `string.char` constructs
text from numeric codepoints; it does not return a buffer address.

Encoded bytes instead occupy mapped storage. `string.from_utf8` takes that
storage's address and a byte count and constructs a String. A static String
reference field is not a substitute for an encoded byte span. **Memory and
program storage** defines these representations, storage declarations,
initialization, reservations and ownership. **CPU and BLua32 instruction
reference** defines Number/word conversion, ordinary indexing and instruction
charges. **BIOS base services** and **Protected calls and coroutines** define
the connected conversion, diagnostic and error interfaces.

The complete program below uses this concrete encoding. String positions start
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

The contracts below describe the installed bindings. Public library fields
remain ordinary mutable values. String method lookup uses the installed
String-index Table, not numeric character indexing. Rebinding the public
`string` global alone does not replace that installed Table. Captured helper
functions and their remaining live dependencies are distinguished below.

## Codepoint access, construction, length and UTF-8 input

These four interfaces operate on codepoints or bring encoded bytes into a
String. Their names do not make a String a byte buffer.

| Interface | Arguments | Normal result |
| --- | --- | --- |
| `string.byte(value, position)` | Required String; optional Number position | Exactly one Number, or exactly one `nil` when the position is outside the String |
| `string.char(...)` | Zero or more Numbers | Exactly one String |
| `string.len(value)` | Required value supporting the length operation | Exactly one Number, if the operation completes |
| `string.from_utf8(address, byte_count)` | Numeric mapped byte address and a byte count | Exactly one String, if decoding completes with the installed bindings |

### `string.byte(value, position)`

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
are ignored. Each call scans forward from the first codepoint to the selected
position; repeatedly selecting later positions repeats that traversal.

A missing or non-String first argument, or a nonnumeric non-`nil` position,
raises `INVALID_ARGUMENT`. A numeric-looking String such as `"2"` is not
accepted as a position.

### `string.char(...)`

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
per-argument or per-result term in that surcharge. This is not the complete
call cost or a constant-time guarantee for scanning or constructing text.

### `string.len(value)`

`string.len(value)` performs the ordinary length operation, `#value`, and
returns its result. On a String it counts codepoints, including zero
codepoints. It does not report an encoded UTF-8 byte count.

On a Table it returns the maintained cached length, not the number of keys or
the largest numeric key. For the Table length operation, its state rules
and its fault handling, follow the CPU chapter's length-operation procedure.
Other value categories raise the ordinary length error,
`"Attempted to get length of an unsupported value."`.

### `string.from_utf8(address, byte_count)`

Use this interface when the input already exists as mapped UTF-8 bytes.
`address` is the numeric address of the first byte; `byte_count` is the number
of **encoded bytes**, not the number of codepoints. Supply both arguments.
A String value, or the address of a field holding a String constant index, is
not the address of its encoded text.

The caller must provide backed storage containing complete, well-formed
UTF-8 sequences and keep those bytes valid and stable while decoding reads
them. The function does not allocate the input storage or grant access to it.
An embedded byte `0x00` becomes codepoint zero and does not end the input.
With the installed bindings, a zero byte count returns one empty String.

<section class="keep-together">

The byte count controls whether another lead byte is read. It is **not a
hard read barrier** for the continuation bytes of a sequence already begun:

| Lead byte value | Bytes read for that sequence, including the lead |
| --- | --- |
| `0x00`–`0x7f` | 1 |
| `0x80`–`0xdf` | 2 |
| `0xe0`–`0xef` | 3 |
| `0xf0`–`0xff` | 4 |

</section>

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
the Memory, CPU and SYSTEM rules; this interface supplies no rollback or
separate invalid-UTF-8 error contract.

Literal escapes do not perform this decoding. The String literal
`"\xc3\xa9"` contains two codepoints, `0xc3` and `0xa9`. To obtain codepoint
`0xe9` from the encoded bytes `0xc3, 0xa9`, put those bytes in mapped storage
and call `string.from_utf8` with that address and a byte count of 2.

The decoder stages 256 codepoints per chunk and joins its chunks into the
returned String. This is not a 256-codepoint size limit: a 257-byte input
containing only `0x41` produces 257 codepoints. After normal return, the String
is not a live view of the source bytes; rewriting those bytes does not change
the returned text. No fixed cycle budget or maximum successful input size is
specified here.

The decoder retains its `char`, `table.unpack` and `table.concat` function
values. Replacing their public fields does not replace these calls. The
captured `unpack` still uses the current global `select` for an empty range;
the captured `concat` still uses the current global `tostring` for its joins.
Changing those globals can therefore change the empty-span or chunk-join
result. **BIOS table library** describes the helper procedures.

## Case conversion, slicing, reversal and repetition

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

### ASCII case conversion

`upper` subtracts 32 from codes 97 through 122. `lower` adds 32 to codes
65 through 90. Neither operation performs locale-sensitive conversion or
Unicode case folding.

```lua
local text = string.char(65, 122, 233, 128640)
local capitals = string.upper(text) -- codes 65, 90, 233, 128640
local small = string.lower(text)    -- codes 97, 122, 233, 128640
```

Both functions obtain `L = #value`, visit positions 1 through L, construct a
String for each mapped codepoint, and join the temporary Table with their
captured `table.concat`. An empty String therefore produces an empty String.

There is no preliminary String-only check. A Table with L = 0 produces an empty
String without a codepoint read. A Table with L > 0 reaches `string.byte`, which
rejects the Table with `Invalid argument.` Other value kinds fail at the length
operation with `Attempted to get length of an unsupported value.` rather than
being converted to text.

### Inclusive slices

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

### Codepoint reversal

`string.reverse` captures `L = #value`. If L is at most 1, it returns the original
value. Otherwise, it reads positions L down to 1, constructs a String for each
codepoint, and joins the temporary Table with captured `table.concat`.

```lua
local backwards = string.reverse('ABC') -- 'CBA'
```

This reverses codepoints, not UTF-8 bytes or grapheme clusters. A combining
character therefore moves independently of its neighbouring codepoint.

The early return also applies to a Table whose captured L is 0 or 1: the result
is that Table, not a String. With a Table whose L is greater than 1, the first
codepoint read raises `Invalid argument.` Other value kinds fail at the length
operation.

### Repetition and separators

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
observable branch order matters:

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

For a positive finite count, repetition uses parity tests and repeated halving
of the remaining count, doubling an intermediate chunk when more work remains.
It does not concatenate one copy per loop iteration. Intermediate Strings and
the requested output still consume resources; there is no function-local
repetition or output-size cap. Negative infinity takes the empty-result branch.
Positive infinity does not decrease under halving, so it is not a terminating
repetition request and may exhaust resources.

### Captured calls and work performed

The codepoint-building paths above use captured `string.byte`, `string.char`
and `table.concat` function values. Replacing those public fields later does
not replace the captured calls. This is not a promise
that all later rebinding is irrelevant: the captured concat function still
consults the current global `tostring`. If that global is replaced with a
function returning `'x'` for every argument, `string.upper('ab')` produces
`'xx'`.

Each codepoint read starts scanning at the beginning of its source String.
Repeated indexed reads are therefore repeated scans, not constant-time random
access. The mapping, slice and reversal paths also construct temporary Tables
and Strings; they are not in-place transformations or single-pass byte-buffer
operations.

## Complete program: codepoints and mapped UTF-8

The installed `string` global is used directly. The two complete modules below
construct and transform text, compare a codepoint count with an encoded byte
count, catch two argument errors, and decode caller-owned mapped storage. No
cartridge-local decoder or encoding helper is required.

The result module is named `results`. It exports the result address and a
257-byte BSS buffer. The entry imports both addresses and declares its two
readonly encoded byte spans. **Memory and program storage** explains the
module, BSS, readonly storage and typed views. The retained words are scalar
codepoints, counts or explicit comparison observations, not encodings of
arbitrary language values.

### Result storage

```lua
module<const>

struct bios_string_manual_result
	completed: word
	byte_count: word
	text_length: word
	codepoints: word[4]
	upper_match: word
	lower_match: word
	slice_tail_match: word
	slice_fraction_match: word
	slice_zero_length: word
	slice_clamped_match: word
	reverse_match: word
	repeat_match: word
	repeat_zero_length: word
	repeat_default_match: word
	byte_missing_nil: word
	byte_result_count: word
	byte_fraction: word
	byte_wrapped: word
	char_wrapped_match: word
	char_empty_length: word
	invalid_char_error: word
	invalid_position_error: word
	decoded_match: word
	nul_length: word
	nul_codepoint: word
	short_span_codepoint: word
	chunk_length: word
	chunk_edges: word[3]
end

bss result: bios_string_manual_result
bss chunk_bytes: u8[257]

return { result = result, chunk_bytes = chunk_bytes }
```

### Entry, part 1: construct text and change ASCII case

The four supplied codepoints are `41H`, `7AH`, `E9H` and `1F680H`. Their encoded
UTF-8 span occupies eight bytes. `string.len` reports four codepoints, and each
`byte` call selects one complete codepoint. The names of those two operations
do not turn a String into byte-addressed storage.

Uppercase changes `7AH` to `5AH`; lowercase changes `41H` to `61H`. The two
non-ASCII codepoints are unchanged in both comparisons. Diagnostics print
numeric codepoints and comparison words, so this example does not require a
text display capable of drawing every supplied codepoint.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_string_manual_result = state.result

rodata utf8_bytes: u8[8] = {
	0x41, 0x7a, 0xc3, 0xa9, 0xf0, 0x9f, 0x9a, 0x80,
}
rodata nul_bytes: u8[3] = { 0x41, 0, 0x42 }

-- Construct four codepoints; the mapped UTF-8 representation has eight bytes.
local text<const> = string.char(0x41, 0x7a, 0xe9, 0x1f680)
result.byte_count = #utf8_bytes
result.text_length = string.len(text)
for index = 0, 3 do
	result.codepoints[index] = string.byte(text, index + 1)
end
print('String sizes', result.byte_count, result.text_length)
print('Codepoints', result.codepoints[0], result.codepoints[1],
	result.codepoints[2], result.codepoints[3])

-- ASCII case changes do not change the non-ASCII codepoints.
result.upper_match = string.upper(text)
	== string.char(0x41, 0x5a, 0xe9, 0x1f680) and 1 or 0
result.lower_match = string.lower(text)
	== string.char(0x61, 0x7a, 0xe9, 0x1f680) and 1 or 0
print('ASCII case', result.upper_match, result.lower_match)

```

### Entry, part 2: select, reverse and repeat

The method call `text:sub(2, -1)` selects the final three codepoints. The
fractional bounds `2.9, 3.9` select positions two and three after flooring.
`sub(0, 0)` is empty: its zero end bound is not the Table range convention
that chooses the maintained length. The outer bounds `-99, 99` clamp to the
whole input. Reversal preserves each complete codepoint while changing order.

The repeated text is `go/go/go`. A zero count gives an empty String; the
omitted count in the final call gives one copy. Comparison words below record
those actual results rather than assigning String values into byte storage.

```lua
-- Method syntax uses the installed String-index table, not byte indexing.
result.slice_tail_match = text:sub(2, -1)
	== string.char(0x7a, 0xe9, 0x1f680) and 1 or 0
result.slice_fraction_match = string.sub(text, 2.9, 3.9)
	== string.char(0x7a, 0xe9) and 1 or 0
result.slice_zero_length = #string.sub(text, 0, 0)
result.slice_clamped_match = string.sub(text, -99, 99) == text and 1 or 0
result.reverse_match = string.reverse(text)
	== string.char(0x1f680, 0xe9, 0x7a, 0x41) and 1 or 0
print('Slices', result.slice_tail_match, result.slice_fraction_match,
	result.slice_zero_length, result.slice_clamped_match, result.reverse_match)

local repeated<const> = string.rep('go', 3, '/')
result.repeat_match = repeated == 'go/go/go' and 1 or 0
result.repeat_zero_length = #string.rep('go', 0, '/')
result.repeat_default_match = string.rep('one') == 'one' and 1 or 0
print('Repetition', repeated, result.repeat_zero_length,
	result.repeat_default_match)

```

### Entry, part 3: scalar conversion and reached errors

`byte`'s negative index gives one nil result; it does not count backward from
the end. A third argument does not request a range. The program counts exactly
one result from that call. Its fractional index `2.9` converts to signed word
`2`; `100000001H` converts to `1`. `char(100000041H)` converts its numeric
argument to unsigned word `41H` before checking scalar validity; `char()`
produces an empty String.

The two protected calls then reach actual argument errors: `D800H` is a
surrogate value, and the String `'2'` is not a numeric `byte` index. Each
returns false and the original error String `Invalid argument.`. These two
checks are not a general argument-validation rule for every wrapper.

```lua
-- byte selects one codepoint, not an interval.
-- Its index uses signed-word conversion.
result.byte_missing_nil = string.byte(text, -1) == nil and 1 or 0
result.byte_result_count = select('#', string.byte(text, 2, 4))
result.byte_fraction = string.byte(text, 2.9)
result.byte_wrapped = string.byte(text, 0x100000001)
result.char_wrapped_match = string.char(0x100000041) == 'A' and 1 or 0
result.char_empty_length = #string.char()
print('Scalar conversion', result.byte_missing_nil, result.byte_result_count,
	result.byte_fraction, result.byte_wrapped, result.char_wrapped_match,
	result.char_empty_length)
local char_ok<const>, char_error<const> = pcall(string.char, 0xd800)
local index_ok<const>, index_error<const> = pcall(string.byte, text, '2')
result.invalid_char_error =
	not char_ok and char_error == 'Invalid argument.' and 1 or 0
result.invalid_position_error =
	not index_ok and index_error == 'Invalid argument.' and 1 or 0
print('Rejected arguments', char_ok, char_error, index_ok, index_error)

```

### Entry, part 4: decode mapped byte spans

The complete eight-byte span decodes to the same four-codepoint String.
The second span contains a zero byte between `41H` and `42H`; decoding returns
three codepoints and the middle codepoint is zero, not a terminator.

The short-span observation is deliberately bounded: the two-byte encoding of
`E9H` is fully present in readonly mapped storage, but the call declares only
one byte. Its lead still causes the continuation byte to be read, producing
`E9H`. A byte count ending inside an encoding is therefore not a hard read
boundary. Do not substitute an unmapped continuation address for this prepared
example.

Finally the program fills every byte of its 257-byte BSS buffer with `41H`
before decoding. After decoding, the program reuses the first source byte for `5AH`. The
returned length remains 257, with `41H` at positions 1, 256 and 257, while a
source readback gives `5AH`. The returned String is not a live byte-buffer
view. The internal 256-codepoint staging chunk is not the maximum input size. This observation proves the shown size, not a universal size or cycle
limit. Completion is recorded before the final `halt_until_irq` loop.

```lua
-- Decode caller-owned mapped byte spans with the BIOS, not a local codec.
result.decoded_match =
	string.from_utf8(utf8_bytes, #utf8_bytes) == text and 1 or 0
local with_nul<const> = string.from_utf8(nul_bytes, #nul_bytes)
result.nul_length = #with_nul
result.nul_codepoint = string.byte(with_nul, 2)
-- Both bytes are mapped: the lead still reads its continuation past count 1.
result.short_span_codepoint = string.byte(string.from_utf8(&utf8_bytes[2], 1))
print('Mapped decoding', result.decoded_match, result.nul_length,
	result.nul_codepoint, result.short_span_codepoint)

-- The decoder's 256-codepoint staging chunk is not a 256-character input limit.
local chunk<const>: *u8 = state.chunk_bytes
for index = 0, 256 do
	chunk[index] = 0x41
end
local long_text<const> = string.from_utf8(chunk, 257)
-- Reusing the source after return does not change the constructed String.
chunk[0] = 0x5a
result.chunk_length = #long_text
result.chunk_edges[0] = string.byte(long_text, 1)
result.chunk_edges[1] = string.byte(long_text, 256)
result.chunk_edges[2] = string.byte(long_text, 257)
print('Chunk boundary', result.chunk_length, result.chunk_edges[0],
	result.chunk_edges[1], result.chunk_edges[2], chunk[0])
result.completed = 1
while true do
	halt_until_irq
end
```

<section class="keep-together">

### Retained observations

A comparison word of one means the stated relation was true. Arrays below
are in typed-storage order, starting at index zero. Every retained result
field is named here; the separately exported byte buffer is input storage.

| Field | Retained value |
| --- | --- |
| `completed` | `1` |
| `byte_count`, `text_length` | `8`, `4` |
| `codepoints` | `65`, `122`, `233`, `128640` |
| `upper_match`, `lower_match` | `1`, `1` |
| `slice_tail_match`, `slice_fraction_match` | `1`, `1` |
| `slice_zero_length`, `slice_clamped_match` | `0`, `1` |
| `reverse_match` | `1` |
| `repeat_match`, `repeat_zero_length`, `repeat_default_match` | `1`, `0`, `1` |
| `byte_missing_nil`, `byte_result_count` | `1`, `1` |
| `byte_fraction`, `byte_wrapped` | `122`, `65` |
| `char_wrapped_match`, `char_empty_length` | `1`, `0` |
| `invalid_char_error`, `invalid_position_error` | `1`, `1` |
| `decoded_match` | `1` |
| `nul_length`, `nul_codepoint` | `3`, `0` |
| `short_span_codepoint` | `233` |
| `chunk_length` | `257` |
| `chunk_edges` | `65`, `65`, `65` |

</section>

### Diagnostic output

After startup, the program emits these nine lines. Separators between printed
arguments are literal tabs. The codepoints are printed numerically; no glyph
rendering or framebuffer result is implied.

```text
String sizes	8	4
Codepoints	65	122	233	128640
ASCII case	1	1
Slices	1	1	0	1	1
Repetition	go/go/go	0	1
Scalar conversion	1	1	122	65	1	0
Rejected arguments	false	Invalid argument.	false	Invalid argument.
Mapped decoding	1	3	0	233
Chunk boundary	257	65	65	65	90
```

## `string.format`

```lua
string.format(format, ...)
```

Number arithmetic and value categories follow [Values and numeric instructions](cpu.md#values-and-numeric-instructions). Hexadecimal limits below use the `H` suffix.

Builds formatted text and, on normal completion, returns exactly one String. It does not return a character count or write into a caller-supplied buffer. Unused arguments are ignored.

For a String `format`, positions, field widths and String precisions count Unicode codepoints, not UTF-8 bytes. Literal codepoints are copied in order. An embedded NUL does not terminate the format. The main scan uses the initial format length; decimal width and precision parsing re-evaluate that length at each loop test.

**Table-length boundary.** There is no String-only entry check: the first operation is `#format`. Categories other than String and Table fail at that operation. A Table whose length is obtained as zero returns an empty String; a positive length leads to a codepoint-read operation that requires a String and fails. The common Table-length contract remains unresolved. This also affects ordinary String formats: general-uppercase conversion and substring operations used by precision-limited `%s` and general-format zero stripping can construct temporary Tables and use their lengths. Their complete results cannot be specified unconditionally here. Do not assume every Table `format` argument fails at entry.

### Conversion syntax and argument order

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

### Flags, signs and padding

Width is a minimum, never a truncation limit. Padding measures the combined codepoint lengths of sign, base prefix and content. If padding is needed, `-` appends spaces and overrides `0`. Otherwise `0` inserts zeros after the sign and base prefix; ordinary padding inserts spaces before both.

For signed conversions, a value less than zero selects `-`; otherwise `+` selects `+`, then space selects one leading space. Thus `+` overrides space. Sign selection does not inspect a negative-zero sign bit.

| Conversion group | Flag and precision effects |
| --- | --- |
| `s`, `c`, `q` | Space padding only; `+`, space and `#` have no conversion effect. |
| `d`, `i` | Signed decimal; `+` and space select a nonnegative sign. `#` adds no prefix. |
| `u`, `o`, `x`, `X` | No sign from `+` or space. `#` affects octal and hexadecimal as described below. |
| All integers | Any present precision disables width zero-padding, including precision zero. |
| Floating conversions | Width zero-padding remains active when precision is present. `#` retains a point at zero precision in fixed/scientific construction and disables general-format zero stripping. |

### Text, codepoint and quoted conversions

**`%s` — text.** Calls the current `tostring` on the argument, then, if precision is present, takes codepoints 1 through that precision before applying width. For an ordinary converted String, precision zero gives empty content. The argument need not originally be a String. Substring construction is subject to the Table-length boundary above.

**`%c` — codepoints from integer and fraction.** The installed function passes both `math.modf` results to `string.char`, integer part first and fractional part second. It consumes one format value and returns one String, not two return values. Each Number is converted to an unsigned 32-bit word by truncation and wrapping. A resulting word greater than `10FFFFH` or within `D800H`–`DFFFH` raises the codepoint error; zero is String content, not a terminator. Number NaN and either infinity become word zero. Original non-Number arguments become Number NaNs through `modf`, rather than reaching `char` with their original category.

For the installed bindings, `string.format('%c', 0)` contains two zero codepoints; both `string.format('%c', 65)` and `string.format('%c', 65.75)` contain codepoints 65 and 0. This differs from the one-codepoint `string.char(65)` form. Width measures the complete formatted String. Precision is ignored, but a precision star still consumes an argument.

<section class="keep-together">

**`%q` — quoted text.** Calls the current `tostring`, surrounds the resulting text with double quotes, and escapes its codepoints as follows:

| Codepoint | Emitted escape |
| --- | --- |
| 10 | `\n` |
| 13 | `\r` |
| 9 | `\t` |
| 92, backslash | `\\` |
| 34, double quote | `\"` |
| Other values below 32, and 127 | Backslash followed by the decimal code, zero-padded to three digits. |

</section>

Every other codepoint is copied unchanged. Width applies after quoting. Precision is ignored, including after consuming a precision star. Because conversion to text happens first, `%q` is not a promise of round-trip serialization of the original value.

### Integer conversions

`%d` and `%i` take the first `math.modf` result. Finite fractions truncate toward zero, and a negative integer is formatted using its positive magnitude and a separate minus sign. These conversions do not impose a 32-bit word limit.

`%u`, `%o`, `%x` and `%X` take that same first result, apply a bitwise AND with `FFFFFFFFH`, and interpret the result as an unsigned 32-bit magnitude. `%u` uses decimal, `%o` octal, and `%x`/`%X` hexadecimal with lowercase/uppercase letters.

Zero initially produces one `0`. Other magnitudes are converted by repeated remainder and floor division in the selected base. Integer precision adds leading zeros to the requested minimum digit count. Precision zero clears the digits when the magnitude is zero.

For `#` octal, empty digits are restored to one `0`; otherwise a leading `0` is added only if the first digit is not already zero. For `#` hexadecimal, `0x` or `0X` is added only for a nonzero magnitude. The common width rules then place sign, prefix and padding.

A signed NaN magnitude produces no initial digits; sign flags, precision and width can still add text. Non-Number arguments reach signed integer formatting as Number NaN. Unsigned conversion maps both that result and Number NaN or either infinity to zero. Either infinity in signed integer conversion produces a positive-infinite magnitude and enters repeated base division without a finite progress condition; completion is not guaranteed.

### Floating conversions

`f`/`F` select fixed construction, `e`/`E` scientific construction, and `g`/`G` general construction. They do not validate the original argument as a Number or parse numeric Strings.

A Number NaN is handled before construction as `nan` or `NAN`; either infinity is handled as `inf` or `INF`. Sign selection is separate, so negative infinity receives a minus sign and nonnegative special values may receive `+` or space. For other arguments, sign is selected from the original value and a value less than zero is negated to obtain the magnitude.

Non-Number arguments do not match the initial Number-special cases. Comparisons with the numeric constants are false, and subsequent arithmetic produces Number NaN. The selected construction below therefore proceeds with NaN arithmetic and text pieces; this is not the initial `nan`/`NAN` shortcut or a formatter-specific argument error.

<section class="keep-together">

**Fixed construction (`f`, `F`).** Precision defaults to six; explicit zero is retained. For magnitude `v` and precision `p`, construct `scale` by starting at one and multiplying by ten `p` times, then calculate:

```text
rounded  = first modf result of (v * scale + 0.5)
whole    = rounded // scale
fraction = rounded % scale
```

</section>

Convert `whole` with the current `tostring`. When `p > 0`, append a dot and `tostring(fraction)`, padding that fraction text on the left with zeros to at least `p` codepoints. At precision zero, append a dot only for `#`.

**Scientific construction (`e`, `E`).** Precision also defaults to six. Zero uses fixed construction followed by exponent zero. Otherwise repeatedly divide the magnitude by ten while it is at least ten, or multiply it by ten while it is positive and below one, tracking the exponent from zero. Round the resulting mantissa using the same multiply-plus-half and first-`modf` operation. If the rounded value is at least `10 * scale`, divide it by ten using floor division and increment the exponent. Construct the whole/fraction text as above, then append `e` or `E`, an explicit exponent sign, and the current `tostring` of the absolute exponent, left-padded with zeros to at least two codepoints. Two is a minimum, not an exponent limit.

**General construction (`g`, `G`).** Precision defaults to six significant digits; explicit zero becomes one. Determine the decimal exponent from the unrounded magnitude, using exponent zero for zero. If the exponent is below −4 or at least the significant-digit precision, select scientific construction with precision one less than the significant-digit count. Otherwise select fixed construction with precision `significant − exponent − 1`. The choice is not repeated after rounding.

Without `#`, detach the first `e`/`E` suffix, remove every trailing zero from the preceding text, remove a trailing dot if present, and reattach the suffix. This stripping does not require a decimal point: it can remove integer trailing zeros as well. `#` skips stripping. `G` then applies ASCII-only uppercasing to the resulting text. Stripping and uppercasing are subject to the Table-length boundary above.

**Default numeric text dependency.** The whole, fraction and exponent text pieces above use `tostring`; precision does not substitute an arbitrary-length decimal writer. Under the installed default, Nil becomes `nil`, Booleans become `false` or `true`, Tables become `table`, Threads become `thread`, function values become `function`, and Strings retain their contents. Number specials become `nan`, `-inf` or `inf`.

For finite Numbers, default text conversion writes positive zero as `0`, preserves a received negative zero as `-0`, and writes nonzero integral magnitudes below 1,000,000 exactly. Other finite-number text uses a six-significant-digit general algorithm: normalize, scale by 100,000, round with ties to even, adjust a six-digit carry, then choose fixed notation only for a post-rounding exponent from −4 through 5. Otherwise it uses lowercase `e`, an explicit sign and at least two exponent digits. Fractional trailing zeros are removed. This text algorithm is distinct from the formatter's multiply-plus-half rounding. Consequently, requested floating precision does not guarantee that all whole/fraction pieces are plain fixed decimal digits, or that every requested decimal digit is accurate.

### Errors, completed work and limits

With the installed `error`, an incomplete conversion raises the String:

```text
string.format incomplete format specifier.
```

This includes a final bare `%`, a final dot, and a conversion that ends after its flags, fields or ignored modifiers. An unsupported conversion raises `string.format unsupported format specifier '%C'.`, where `C` is replaced by that actual codepoint, not restricted to ASCII.

<section class="keep-together">

These checks are not a preflight of the whole format. Earlier literals, conversions and star selections may already have been processed. A raised error returns neither the partial String nor a count. There is no formatter recovery or rollback. Length evaluation and codepoint operations can also fail; no exact caught-error text for those failures is specified here.

</section>

The formatter retains the installed `string.byte`, `string.char`, `string.sub`, `string.rep`, `table.concat` and `math.modf` functions. Changing those table fields later does not replace the retained functions. In contrast, `tostring`, `select` and `error` are looked up when called; replacing them can alter conversion, argument selection and error behavior. Retained substring and concatenation operations can themselves depend on the current `tostring`.

There is no formatter-level output-length, conversion-count, width, precision or total-work cap. Padding can request large Strings; decimal scaling, normalization and base conversion use value-dependent loops. Positive-infinite precision can leave scaling without progress, and positive-infinite width can reach String repetition. No finite completion, resource-failure outcome or fixed cost is guaranteed for such requests. Repeated codepoint reads start from the beginning of their String, so a format scan is not a one-pass work guarantee. String/heap capacities, allocation-failure handling and fault routing are outside this section's specified boundary.

### Complete program: formatted text

This is a separate cartridge from the codepoint/UTF-8 program. The two complete
modules use the installed `string.format` directly; no cartridge-local formatter
or output-buffer address is involved. The result module is again named `results`,
but declares its own `bios_format_manual_result` layout. Do not combine the two
entry modules in one cartridge. The [formatting build route](../programming/getting-started.md#build-and-inspect-formatted-text)
gives the complete file tree, manifest, commands and observation procedure.

The program covers width and precision argument order, signs and prefixes,
zero integer precision, unsigned conversion, fixed/scientific/general output,
quoted text, the installed `%c` pair, nonnumeric argument paths and two reached
format errors. Its general conversion uses `#` to retain the point and bypass
zero stripping. It does not settle the common Table-length boundary or impose
a general output-size or execution-time limit.

#### Formatting result storage

Every retained field is one word. Comparison words are one when the stated
relation is true, otherwise zero; String values themselves are not written
into those fields.

```lua
module<const>

struct bios_format_manual_result
	completed: word
	basic_match: word
	sign_match: word
	prefix_match: word
	stars_match: word
	left_match: word
	zero_integer_match: word
	float_match: word
	quote_match: word
	unsigned_match: word
	special_match: word
	fixed_large_match: word
	empty_integer_length: word
	nul_length: word
	nul_codepoint: word
	nul_trailing_codepoint: word
	nonnumeric_width_match: word
	incomplete_error: word
	unsupported_error: word
end

bss result: bios_format_manual_result

return { result = result }
```

#### Formatting entry, part 1: fields and stars

Width six includes the sign in `+00042`; width eight includes `0x` in
`0x00002a`. In `%*.*f`, the arguments are width 8, precision 2, then value 1.25.
Four spaces precede `1.25`. The negative width in `%*s` selects left alignment,
so three spaces follow `go`. The printed brackets expose those spaces and are
not part of the formatted Strings.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_format_manual_result = state.result

-- Width is a minimum; zeros follow the sign or base prefix.
local basic<const> = string.format('HP %d/%d', 7, 10)
local signed<const> = string.format('%+06d', 42)
local prefixed<const> = string.format('%#08x', 42)
result.basic_match = basic == 'HP 7/10' and 1 or 0
result.sign_match = signed == '+00042' and 1 or 0
result.prefix_match = prefixed == '0x00002a' and 1 or 0
print('Format fields', basic, signed, prefixed)

-- Stars consume width, then precision, then the value.
local stars<const> = string.format('%*.*f', 8, 2, 1.25)
local left<const> = string.format('%*s', -5, 'go')
result.stars_match = stars == '    1.25' and 1 or 0
result.left_match = left == 'go   ' and 1 or 0
print('Format stars', '[' .. stars .. ']', '[' .. left .. ']')
```

#### Formatting entry, part 2: integer and floating output

Integer precision zero removes zero's decimal digits. Alternate octal still
emits one zero, giving `/0`. Unsigned conversion of −1 gives `4294967295`.
The three floating conversions produce `1.25/1.3e+01/100.`. The final point is
retained by `#`; significant-digit precision does not divide the input.

The large fixed-format example deliberately exposes the numeric-text
construction rule: `string.format('%.0f', 1000000)` returns `1e+06`, not
`1000000`. Its whole-number text uses the default numeric conversion described
above. Do not use requested fixed precision as a guarantee of a plain-decimal
output grammar.

```lua
-- Integer precision zero clears zero digits; alternate octal restores one.
local zeros<const> = string.format('%.0d/%#.0o', 0, 0)
local unsigned<const> = string.format('%u', -1)
result.zero_integer_match = zeros == '/0' and 1 or 0
result.unsigned_match = unsigned == '4294967295' and 1 or 0
print('Format integers', zeros, unsigned)

-- Alternate general format retains its point and skips zero stripping.
local floating<const> = string.format('%.2f/%.1e/%#.3g', 1.25, 12.5, 100)
local special<const> = string.format('%+F/%e', 1 / 0, 0 / 0)
local large<const> = string.format('%.0f', 1000000)
result.float_match = floating == '1.25/1.3e+01/100.' and 1 or 0
result.special_match = special == '+INF/nan' and 1 or 0
result.fixed_large_match = large == '1e+06' and 1 or 0
print('Format numbers', floating, special, large)
```

#### Formatting entry, part 3: codepoints and reached errors

The quoted text contains a tab and double quote. `%q` emits visible escapes
inside double quotes. `%c` receives zero and returns two zero codepoints in
the installed BIOS; length and both codepoints are printed numerically, not
as visible glyphs. A missing `%d` value gives empty digits. The String width
argument `'5'` is not parsed as a Number: its NaN width does not request padding.

The final protected calls report the original incomplete-specifier and
unsupported-`p` error Strings. The width star in `%*p` is processed before the
unsupported conversion is reached. Completion is recorded only after these
observations, followed by the ordinary interrupt-halt loop.

```lua
-- Quoting emits visible escapes; %c retains both modf results in this BIOS.
local quoted<const> = string.format('%q', 'A\t"')
local nul<const> = string.format('%c', 0)
result.quote_match = quoted == '"A\\t\\""' and 1 or 0
result.nul_length = #nul
result.nul_codepoint = string.byte(nul)
result.nul_trailing_codepoint = string.byte(nul, 2)
print('Format text', quoted, result.nul_length, result.nul_codepoint,
	result.nul_trailing_codepoint)

-- These branches do not parse numeric text or impose a common type check.
result.empty_integer_length = #string.format('%d')
result.nonnumeric_width_match = string.format('%*s', '5', 'go') == 'go' and 1 or 0
print('Format argument paths', result.empty_integer_length,
	result.nonnumeric_width_match)

local incomplete_ok<const>, incomplete_error<const> = pcall(string.format, '%')
local unsupported_ok<const>, unsupported_error<const> =
	pcall(string.format, '%*p', 4, 'unused')
result.incomplete_error = not incomplete_ok
	and incomplete_error == 'string.format incomplete format specifier.'
	and 1 or 0
result.unsupported_error = not unsupported_ok
	and unsupported_error == "string.format unsupported format specifier '%p'."
	and 1 or 0
print('Format incomplete', incomplete_ok, incomplete_error)
print('Format unsupported', unsupported_ok, unsupported_error)

result.completed = 1
while true do
	halt_until_irq
end
```

#### Formatting observations

| Fields | Retained values |
| --- | --- |
| `completed` | `1` |
| `basic_match`, `sign_match`, `prefix_match` | `1`, `1`, `1` |
| `stars_match`, `left_match` | `1`, `1` |
| `zero_integer_match`, `unsigned_match` | `1`, `1` |
| `float_match`, `special_match`, `fixed_large_match` | `1`, `1`, `1` |
| `quote_match` | `1` |
| `nul_length`, `nul_codepoint`, `nul_trailing_codepoint` | `2`, `0`, `0` |
| `empty_integer_length`, `nonnumeric_width_match` | `0`, `1` |
| `incomplete_error`, `unsupported_error` | `1`, `1` |

After startup the ordinary cartridge prints these eight lines. Argument
separators are literal tabs; the `\t` within the quoted result is a visible
backslash followed by `t`, not another argument separator.

```text
Format fields	HP 7/10	+00042	0x00002a
Format stars	[    1.25]	[go   ]
Format integers	/0	4294967295
Format numbers	1.25/1.3e+01/100.	+INF/nan	1e+06
Format text	"A\t\""	2	0	0
Format argument paths	0	1
Format incomplete	false	string.format incomplete format specifier.
Format unsupported	false	string.format unsupported format specifier '%p'.
```
