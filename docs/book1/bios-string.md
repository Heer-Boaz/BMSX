# BIOS String operations

The installed BIOS supplies the `string` global before cartridge entry. The
nine base operations construct text, select codepoints, change ASCII case,
take substrings, reverse or repeat values, and decode a mapped UTF-8 byte span.
The separate `string.format` interface builds formatted text. Pattern searches
and substitutions select or replace text; packet packing constructs and reads
formatted String records. No cartridge import is required. These are separate
interfaces, not additional modes of the nine base operations.

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

**Table-length dependency.** There is no String-only entry check: the first operation is `#format`. Categories other than String and Table fail at that operation. A Table whose length is obtained as zero returns an empty String; a positive length leads to a codepoint-read operation that requires a String and fails. General-uppercase conversion and substring operations used by precision-limited `%s` and general-format zero stripping can also construct temporary Tables. All use the [CPU's maintained-length rules](cpu.md#stored-length), not a separate String-specific length rule. Do not assume every Table `format` argument fails at entry.

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

**`%s` — text.** Calls the current `tostring` on the argument, then, if precision is present, takes codepoints 1 through that precision before applying width. For an ordinary converted String, precision zero gives empty content. The argument need not originally be a String. Substring construction uses the maintained-length rule above.

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

Without `#`, detach the first `e`/`E` suffix, remove every trailing zero from the preceding text, remove a trailing dot if present, and reattach the suffix. This stripping does not require a decimal point: it can remove integer trailing zeros as well. `#` skips stripping. `G` then applies ASCII-only uppercasing to the resulting text. Stripping and uppercasing use the maintained-length rule above.

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
zero stripping. It does not impose a general output-size or execution-time limit.

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

## Pattern language

Patterns examine String codepoints, not UTF-8 bytes or grapheme clusters. Positions are codepoint positions. Character classes are ASCII classes; they do not expand to Unicode categories or locale-dependent character groups.

A pattern is interpreted as matching reaches it. There is no separate whole-pattern validation pass. An empty remaining pattern succeeds without consuming input.

### Single-codepoint atoms and escapes

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

### Bracket sets

A bracket set, `[...]`, is an ordinary one-codepoint atom. A `^` immediately after `[` negates membership. The set scanner skips `%` and its following position, and the first other `]` closes the set. An unescaped `]` closes it even when it would be the first member. Write `%]` to include a literal closing bracket.

Inside a set, escapes use the class rules above. Named classes, uppercase complements, and escaped literals are available. The outside-set constructs are not available there: `%b` and `%f` mean literal `b` and `f`, and `%1` means literal `1`.

A range is recognised when an unescaped, single-item left member is followed by `-`. Its right endpoint must also parse as one item for range membership to match. Endpoints are compared as numeric codepoints, inclusively; reversed endpoints match nothing. An escaped endpoint does not form an ordinary codepoint range. A right-side escape can be consumed without contributing range membership.

Do not assume a final hyphen is literal. The range scanner can take the set's closing `]` as the right endpoint. Write `%-` when literal hyphen membership is required.

An unescaped `[` encountered while set membership is traversed is itself passed to the bracket-item parser. This can skip subsequent text; it is not a nested-set union operation. Write `%[` for literal opening-bracket membership.

An empty positive set matches nothing. An empty negated set matches any available source codepoint. A reached `[` without an unescaped closing `]` raises `invalid string pattern`.

### Anchors and search order

Only a `^` at the first pattern position is an anchor. It is removed before matching and restricts the search to its supplied starting position. It does not independently assert the absolute beginning of the String. In repeated matching or substitution, it restricts each search to that operation's current search position. A `^` elsewhere is literal, except for set negation immediately after `[`.

Only a `$` at the final pattern position is an end anchor. It succeeds exactly when the current position is one past the source's last codepoint. A `$` elsewhere is literal.

Without a leading `^`, candidate starts are tried in increasing order, through the position one past the source end. The first successful candidate wins. Capture bookkeeping starts afresh for each candidate. The search does not silently switch to literal searching merely because a pattern looks literal.

### Greedy and minimal repetition

Repetition applies to ordinary single-codepoint atoms, including bracket sets and ordinary escaped classes.

| Suffix | Matching order |
| --- | --- |
| `?` | Try one occurrence, then zero |
| `*` | Greedy zero or more: try the longest span first, then shorter spans |
| `+` | Require one occurrence, then greedily expand the remainder |
| `-` | Minimal zero or more: try the remaining pattern first, then consume another codepoint if needed |

These choices depend on whether the rest of the pattern succeeds. Greedy matching can retreat from its longest span; minimal matching can grow beyond an empty span.

Capture delimiters, balanced matching, frontier matching, and backreferences take their own matching branches before repetition suffixes are considered. They cannot be repeated as groups or special constructs. A following `*`, `+`, `?`, or `-` is processed separately as an ordinary atom, not as repetition of that preceding construct. There is no alternation or counted-repeat construct.

### Captures and backreferences

An opening `(` records the current source position. A closing `)` searches backwards for the most recent capture entry whose finish is still unset and records its finish at the current position. A text capture is extracted from its recorded start through one codepoint before its finish. Capture entries are created in opening order.

The form `()` is different: it records the numeric current position without consuming text. It is a position capture, not an empty text capture.

**Capture-result dependency.** Capture bookkeeping and extraction use the [CPU's maintained Table lengths](cpu.md#stored-length). Returned sequences also follow the ordinary caller's result adjustment.

Outside sets, `%1` through `%9` refer to a previously recorded, finished text capture. A backreference compares that capture's codepoints at the current source position and, on success, advances by the captured length. A missing capture, an unfinished capture, or a position capture raises `invalid string pattern capture` when that reference is reached.

A backreference has exactly one digit. `%10` is `%1` followed by literal `0`; it is not a reference to capture 10. Capture creation has no pattern-local count guard, but the backreference notation still names only entries 1 through 9.

A reached `)` raises `invalid string pattern` if the backwards search finds no entry with an unset finish. That search tests only the finish field; it does not exclude position-capture entries. Structurally odd combinations of position captures and closing parentheses therefore follow that same procedure, rather than a separate balanced-parenthesis validity rule.

Reaching the pattern end does not check for unfinished opening captures. If such a capture is later extracted, extraction computes its finish minus one even though the finish is unset. There is no dedicated unclosed-capture error at pattern end, and no general final outcome for that malformed path is specified here.

### Balanced regions

The form `%bxy` requires the current source codepoint to be `x`. It scans forwards with an iterative depth counter, increasing depth for nested `x` and decreasing it for `y`. When a closing `y` reduces depth to zero, matching continues just after that closing codepoint and after the four-codepoint `%bxy` construct in the pattern. A different starting codepoint, or failure to find a closing delimiter, makes this match fail.

The closing-delimiter comparison is performed before the opening-delimiter comparison. This order also applies when `x` and `y` are the same codepoint.

There is no dedicated preliminary check that both delimiter positions exist. An incomplete `%b` construct proceeds through two String delimiter reads and then the balance scan. That procedural path is not assigned a general malformed-pattern result here.

### Frontiers

The form `%f[set]` is zero-width. It requires the preceding codepoint not to belong to the set and the current codepoint to belong to it. The preceding value is codepoint 0 when the current position is at most 1; otherwise it is read from the preceding String position. The current value is read from the String when the position is at most the source length; otherwise it is codepoint 0. The read applies the signed-32 position conversion of `string.byte`. A converted position below 1 returns `nil`, not codepoint 0. These values take part in the ordinary set-membership test.

The `[` must immediately follow `%f`; otherwise a reached frontier construct raises `invalid string pattern`. Its set uses the same scanner, membership rules, and missing-closing-bracket error as an ordinary bracket set. A successful frontier consumes no source codepoint.

### Reached errors and incomplete forms

Pattern syntax has these explicit error conditions:

| Reached condition | Error text |
| --- | --- |
| A bracket item has no unescaped closing `]` | `invalid string pattern` |
| `%f` is not immediately followed by `[` | `invalid string pattern` |
| `)` finds no capture entry with an unset finish | `invalid string pattern` |
| `%1`–`%9` names a missing, unfinished, or position capture | `invalid string pattern capture` |

These are the pattern-authored payloads, not a promise about diagnostic presentation or a complete catalogue of faults from other String, Table, or arithmetic operations. The error calls use the current global `error` function.

Only reached pattern text is parsed. A failed earlier atom can leave later malformed text unexamined, and a search can finish after its first successful candidate or its single anchored candidate. Conversely, a bracket atom is parsed before the ordinary character check rejects a position beyond the source end; source exhaustion does not universally shield a reached bracket error.

Some operations can avoid the matcher altogether: `find` can return at its initial start bound, creating a `gmatch` iterator does not invoke it, and `gsub` can skip its first matching iteration when its limit comparison is false. Those paths do not validate the unused pattern.

A terminal `%` has no dedicated rejection. Special-escape dispatch first reads a missing token; the ordinary item scan then advances by two pattern positions. If single-codepoint matching is reached, a source position greater than the String length fails before class matching; otherwise class matching receives the missing escape token. Numeric comparisons reached with that missing token are false; this does not establish a final result for every such malformed pattern. Likewise, incomplete balanced constructs, unfinished captures, and structurally odd capture closures must not be assigned a general final result or one of the listed errors merely because they are malformed.

## Pattern searches and substitutions

**Shared result and assembly dependency.** Capture bookkeeping, result sequences,
replacement arguments and output-piece assembly use the [CPU's maintained Table
lengths](cpu.md#stored-length), including helper Tables created for ordinary
String inputs. Returned sequences also pass through the ordinary caller's
result adjustment, defined in **CPU and BLua32 instruction reference**.

### `string.find`

```text
string.find(source, pattern [, start [, plain]])
```

Searches `source` and constructs the start and inclusive end positions of the first match. Positions count String codepoints, beginning at 1; they are neither UTF-8 byte offsets nor grapheme-cluster positions. See **Pattern language** for pattern syntax, capture ordering and position captures.

**Arguments and starting position.** Omitted or nil `start` means 1. Otherwise the function computes `start // 1`: a positive result is used directly, a negative result becomes `#source + result + 1`, and zero becomes 1. A result still below 1 is not clamped. Do not rely on such a start producing ordinary in-range match boundaries. This arithmetic does not parse numeric Strings; a nonnil nonnumber currently makes both sign comparisons false and therefore normalizes to 1. Outcomes for unusual numeric magnitudes and nonfinite positions are not specified here.

If the normalized start is greater than `#source`, `find` returns one nil before inspecting `plain` or the pattern. In particular, a start of `#source + 1` takes this return, even for an empty pattern. Otherwise a pattern search can consider candidates through `#source + 1`. A leading `^` restricts the search to the supplied start; it does not independently assert the beginning of the complete source.

**Literal search.** A truthy `plain` selects literal codepoint comparison instead of the pattern language. Only nil and false disable this option: 0 and the empty String enable it. An empty literal needle constructs `(start, start - 1)` after the initial bound check above. A nonempty needle searches candidate positions in increasing order and constructs the first start/inclusive-end pair; failure returns one nil. Literal search does not interpret captures or any other pattern syntax.

**Pattern results.** Failure returns one nil. On success, `find` builds a result sequence beginning with the match's start and inclusive end. If there are captures, it appends their values in opening order: substring captures are Strings and position captures are Numbers. With no captures, it builds only the two positions. The result sequence is then expanded into return values.

**Arguments, errors and bindings shared by these four functions.** `source` and `pattern` name Strings, but the pattern functions do not perform entry-time coercion or argument validation. Missing fixed parameters are nil; surplus arguments are ignored. Other argument kinds encounter whichever String-length, substring, codepoint, arithmetic, comparison or indexing operation is reached first; there is no general pattern-specific argument error.

Patterns are interpreted as matching reaches them, not validated in a separate pass. Reached syntax errors explicitly raise `invalid string pattern` for an unterminated bracket set, `%f` without its immediately following `[`, or a closing capture with no unfinished capture to close. A reached backreference to a missing, unfinished or position capture raises `invalid string pattern capture`. These are error payloads, not a guarantee about diagnostic formatting or a complete list of shared-operation failures. A terminal `%`, incomplete `%b` delimiters and unfinished opening captures do not have dedicated validation errors; do not substitute standard Lua error rules for them. See **Pattern language** for the corresponding parsing rules.

At installation, all four functions retain the then-installed String `byte` and `sub`, Table `concat` and `unpack`, and `tonumber`, `tostring` and `type`. Replacing those fields or globals later does not replace the retained function references. Their own dependencies can still be dynamic: the installed Table `concat` looks up global `tostring`, and the installed `tonumber` looks up global `type`. Pattern-authored errors look up global `error` when raised. The behavior described here assumes the installed BIOS dependencies, rather than arbitrary rebinding of their nested globals.

These functions provide no explicit pattern-local source-length, pattern-length, capture-count, output-length, recursion-depth or work-step limit. That is not a claim of unlimited machine resources. Pattern search can backtrack, and codepoint reads are not constant-time accesses. No fixed timing, frame, allocation or exhaustion bound is established here.

### `string.match`

```text
string.match(source, pattern [, start])
```

Searches for the first pattern match, using the codepoint positions, start normalization, binding dependencies and reached-error rules described under `string.find`. See **Pattern language** for pattern syntax.

The default start is 1. A nonnil start is processed with `// 1`, negative positions are relative to the end, zero becomes 1, and an excessively negative result is not clamped. Unlike `find`, `match` does not first reject a start greater than `#source`; its search considers candidates from the supplied start through `#source + 1`. A leading `^` restricts it to the supplied start.

Failure returns one nil. On success, `match` builds a result sequence containing the whole matched substring if there are no captures, or the capture values in opening order otherwise. Substring captures are Strings; position captures are Numbers. It expands that sequence into return values, without adding start/end positions.

There is no plain-search argument. Surplus arguments are ignored, rather than selecting a different search mode. Matching is not subject to a fixed local work budget or timing guarantee.

### `string.gmatch`

```text
string.gmatch(source, pattern)
```

Returns one iterator function. The outer call captures `source` and `pattern` and initializes its search position to 1; it does not inspect either input or parse the pattern before returning. It does not return separate state and control values. Surplus outer-call arguments are ignored.

Call the returned function with no arguments; any supplied arguments are ignored. Each call searches from its current codepoint position. Success constructs and expands the same result sequence as `string.match`: the whole match when there are no captures, otherwise capture values in opening order. Failure returns one nil.

After a nonempty match, the next search starts at the match's exclusive end. After an empty match, it starts one position beyond that exclusive end. The search position changes before capture extraction and return-value construction, so an error during those operations can occur after the iterator has advanced. A failed search leaves the position unchanged; there is no latched finished state, and another call repeats that failed search.

A leading `^` applies at each current search position, not just at the absolute beginning of `source`. The iterator does not search for overlapping nonempty matches inside a span it has already consumed. See **Pattern language** for the matching rules and `string.find` for shared bindings and reached errors; those errors are deferred until an iterator call reaches the relevant operation.

One iterator call performs one search, not one bounded matching step. That search can examine all remaining candidate positions and backtrack. The iterator provides no fixed per-call work or timing budget.

### `string.gsub`

```text
string.gsub(source, pattern, replacement [, limit])
```

Builds a substituted String and returns it together with the substitution count. Positions and substring boundaries are codepoint-based. See **Pattern language** for pattern syntax and `string.find` for shared binding dependencies and reached pattern errors.

**Limit and count.** Omitted or nil `limit` means `#source + 1`. Otherwise the function computes `limit // 1` and replaces a negative result with 0. A zero limit skips matching and replacement entirely, assembles the unchanged source tail, and returns that String with count 0. A nonnil nonnumber limit does not parse as a numeric String or raise a `gsub`-specific integer error: its arithmetic result fails the loop comparison, so the replacement loop is likewise skipped. Outcomes for unusual numeric magnitudes and nonfinite limits are not specified here.

The count increases after a successful replacement evaluation, including an evaluation that chooses to keep the original match. The limit bounds completed replacement iterations, not the work spent finding a match, backtracking, looking up a replacement or running a replacement function.

**Replacement arguments.** For each match, the function constructs a replacement-argument sequence: the whole matched substring when there are no explicit captures, otherwise capture values in opening order. Substring captures are Strings and position captures are Numbers. The whole match remains separately available to the replacement rules below.

- **String or Number:** first convert the replacement with the retained `tostring`, then parse its text. Ordinary codepoints copy literally. `%%` emits `%`; `%0` emits the whole match. For another codepoint following `%`, the retained `tonumber` is used: a numeric result selects that numbered replacement-argument entry, and a missing entry contributes an empty String; a nonnumeric token is emitted without the `%`. A final lone `%` is copied literally. Consequently `%1` refers to the whole match when there are no captures. Numeric position-capture values reach the output conversion as Numbers.
- **Table:** use the first replacement argument as the key when the argument sequence has entries, otherwise use the whole match. This is an ordinary table lookup. Its metatable lookup follows Table-valued `__index` chains; it does not call a Function-valued `__index`. A nil result keeps the whole match. Every other result, including false, is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.
- **Function:** pass the replacement arguments separately when their sequence has entries, otherwise pass the whole match. Only the first return value is used. Nil or false keeps the whole match; any truthy value is converted with the retained `tostring`. The returned text is not reparsed for `%` substitutions.

A replacement of any other kind raises exactly `string.gsub replacement must be a string, number, function, or table.` only when a match reaches replacement evaluation. A zero limit or an unsuccessful search does not prevalidate the replacement.

**Search advancement and assembly.** Searching begins at position 1. For each match, the function appends the unmatched prefix and the evaluated replacement. A nonempty match moves both the next search position and the beginning of the remaining source tail to the match's exclusive end; it does not search for overlaps inside the consumed span.

For an empty match, after replacement evaluation the function first checks the *previous* search position. If that position is already greater than `#source`, it stops. Otherwise it sets both the next search position and the remaining-tail position to one position beyond the empty match's exclusive end. This advances past a source position without appending that position's codepoint. Do not assume the character-preserving empty-match behavior of another Lua implementation. An empty match immediately after a nonempty match is not automatically suppressed.

After substitution stops, the remaining source tail is appended and the output pieces are concatenated. A leading `^` is applied at every current search position, not as a one-time absolute-source-beginning restriction.

A replacement function can have observable effects before a later match or operation fails. Those effects are not rolled back. If a reached operation raises an error, `gsub` does not return a partial output or count. Its private count advances only after replacement evaluation returns. There is no explicit pattern-local output-size or execution-time guard, and no timing or resource-exhaustion threshold is established here.

### Complete program: patterns and substitutions

This is a separate cartridge, with its own `results` module and sole entry
module. The [pattern build route](../programming/getting-started.md#build-and-inspect-pattern-searches)
gives the complete tree, manifest and commands. Save **Pattern result storage**
as `results.lua`; join the five entry parts in order with one blank line
between parts as `cart.lua`. There is no local matcher, codec or library import.

The program uses literal and pattern search, text and position captures,
generic iteration, greedy/minimal matching, balanced regions, frontiers and
backreferences. It then contrasts text, Table and Function replacements and
shows the installed empty-match and deferred-error behavior.

#### Pattern result storage

All retained scalars are words. Comparison words are 1 for a true comparison,
otherwise 0. `word_heads` holds three codepoint Numbers, not String addresses;
its typed-array indices start at zero.

```lua
module<const>

struct bios_pattern_manual_result
	completed: word
	plain_start: word
	plain_end: word
	pattern_start: word
	pattern_end: word
	capture_match: word
	coordinate_match: word
	position_capture: word
	position_text_match: word
	negative_start: word
	empty_find_nil: word
	empty_match_length: word
	word_count: word
	word_heads: word[3]
	anchored_count: word
	greedy_match: word
	minimal_match: word
	balanced_match: word
	frontier_match: word
	backreference_match: word
	complement_match: word
	string_replacement_match: word
	string_replacement_count: word
	table_replacement_match: word
	table_replacement_count: word
	callback_replacement_match: word
	callback_replacement_count: word
	callback_calls: word
	empty_substitution_match: word
	empty_substitution_count: word
	zero_limit_match: word
	zero_limit_count: word
	deferred_replacement_match: word
	deferred_replacement_count: word
	invalid_pattern_error: word
	invalid_capture_error: word
	invalid_replacement_error: word
	unicode_start: word
	unicode_end: word
end

bss result: bios_pattern_manual_result

return { result = result }
```

<section class="keep-together">

#### Pattern entry, part 1: positions and captures

The dot is literal only when the fourth `find` argument is truthy. Negative
start −3 selects position 4 in `abcabc`. The Unicode source has three
codepoints, so the rocket is at position 3. The anchored record pattern captures
`ship_17`, `12` and `-3`; `tonumber` converts the two coordinate Strings.
`()` records position 5 before `42`. An empty search at position 4 of `abc`
distinguishes `find`'s initial bound from `match`'s extra candidate.

</section>

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_pattern_manual_result = state.result

-- The fourth argument chooses a literal dot instead of the any-codepoint atom.
result.plain_start, result.plain_end = string.find('a.b', '.', 1, true)
result.pattern_start, result.pattern_end = string.find('a.b', '.', 1, false)
result.negative_start = string.find('abcabc', 'a', -3, true)
local unicode<const> = string.char(233) .. '.' .. string.char(128640)
result.unicode_start, result.unicode_end =
	string.find(unicode, string.char(128640), 1, true)
print('Pattern positions', result.plain_start, result.plain_end,
	result.pattern_start, result.pattern_end,
	result.negative_start, result.unicode_start, result.unicode_end)

-- %w includes underscore. Captures return text; () instead records a position.
local name<const>, x_text<const>, y_text<const> =
	string.match('ship_17 x=12 y=-3', '^(%w+)%s+x=(%-?%d+)%s+y=(%-?%d+)$')
result.capture_match = name == 'ship_17' and 1 or 0
result.coordinate_match = tonumber(x_text) == 12 and tonumber(y_text) == -3
	and 1 or 0
local digits
result.position_capture, digits = string.match('tag=42', '()(%d+)')
result.position_text_match = digits == '42' and 1 or 0
-- find rejects source-length+1 before matching; match can try that position.
result.empty_find_nil = string.find('abc', '', 4) == nil and 1 or 0
result.empty_match_length = #string.match('abc', '', 4)
print('Pattern captures', name, x_text, y_text, result.position_capture, digits)
print('Pattern end search', result.empty_find_nil, result.empty_match_length)
```

#### Pattern entry, part 2: iteration and matching choices

The ordinary generic loop consumes the iterator directly. Its three first
codepoints are 99, 100 and 115. The second loop deliberately uses `^.`:
the anchor restricts each current search, so this example still produces three
items. The following checks compare greedy and minimal spans, nested balanced
parentheses, a word frontier, a repeated text capture and the `%Q` complement.

```lua
-- The iterator can be used directly by an ordinary generic for loop.
local word_count = 0
for word in string.gmatch('cat dog ship_17', '%w+') do
	result.word_heads[word_count] = string.byte(word)
	word_count = word_count + 1
end
result.word_count = word_count
local anchored_count = 0
for item in string.gmatch('abc', '^.') do
	anchored_count = anchored_count + 1
end
result.anchored_count = anchored_count
print('Pattern iteration', word_count, result.word_heads[0],
	result.word_heads[1], result.word_heads[2], anchored_count)

local greedy<const> = string.match('a1b2b', 'a.*b')
local minimal<const> = string.match('a1b2b', 'a.-b')
local balanced<const> = string.match('x(a(b)c)y', '%b()')
local frontier<const> = string.match('cat scatter', '%f[%w]cat%f[%W]')
local backreference<const> = string.match('go go stop', '(%w+)%s+%1')
result.greedy_match = greedy == 'a1b2b' and 1 or 0
result.minimal_match = minimal == 'a1b' and 1 or 0
result.balanced_match = balanced == '(a(b)c)' and 1 or 0
result.frontier_match = frontier == 'cat' and 1 or 0
result.backreference_match = backreference == 'go' and 1 or 0
result.complement_match = string.match('qZ', '%Q') == 'Z' and 1 or 0
print('Pattern atoms', greedy, minimal, balanced, frontier, backreference,
	result.complement_match)
```

#### Pattern entry, part 3: text and Table replacements

Text replacement brackets each captured word. The Table maps `red` to false,
which becomes the text `false`; its absent `blue` entry preserves the match.
Both successful replacement evaluations count, including the preserved word.

```lua
local substituted<const>, substitutions<const> =
	string.gsub('red blue', '(%a+)', '[%1]')
result.string_replacement_match = substituted == '[red] [blue]' and 1 or 0
result.string_replacement_count = substitutions
-- Table false becomes text; a missing table value preserves the original.
local mapped<const>, mapped_count<const> =
	string.gsub('red blue', '(%a+)', { red = false })
result.table_replacement_match = mapped == 'false blue' and 1 or 0
result.table_replacement_count = mapped_count
print('Pattern replacement text', substituted, substitutions, mapped,
	mapped_count)
```

#### Pattern entry, part 4: callback and empty replacements

The callback changes a counter for each match. Returning false keeps `red`;
returning `B, ignored` uses only `B`. The empty pattern is a separate caution:
its advancement skips the source codepoints rather than copying them, producing
four underscores from `abc`, with count 4.

```lua
-- Callback false preserves the match; only its first returned value is used.
local callback_calls = 0
local changed<const>, changed_count<const> =
	string.gsub('red blue', '(%a+)', function(word)
		callback_calls = callback_calls + 1
		if word == 'red' then
			return false
		end
		return 'B', 'ignored'
	end)
result.callback_replacement_match = changed == 'red B' and 1 or 0
result.callback_replacement_count = changed_count
result.callback_calls = callback_calls
-- Empty matches advance past source codepoints without copying them.
local empty_changed<const>, empty_count<const> = string.gsub('abc', '', '_')
result.empty_substitution_match = empty_changed == '____' and 1 or 0
result.empty_substitution_count = empty_count
print('Pattern replacement callback', changed, changed_count, callback_calls)
print('Pattern replacement empty', empty_changed, empty_count)
```

#### Pattern entry, part 5: reached errors and completion

A zero limit does not reach the malformed `[` or invalid replacement. An
unsuccessful search likewise leaves the invalid replacement unexamined. The
three protected calls then deliberately reach the syntax, capture and
replacement errors. The cartridge records their payload comparisons before
setting `completed` and waiting for interrupts. Reaching completion alone is
not a claim that all comparisons were true.

```lua
-- Unreached pattern/replacement errors are not prevalidated.
local limited<const>, limited_count<const> = string.gsub('x', '[', false, 0)
result.zero_limit_match = limited == 'x' and 1 or 0
result.zero_limit_count = limited_count
local unchanged<const>, unchanged_count<const> = string.gsub('x', 'z', false)
result.deferred_replacement_match = unchanged == 'x' and 1 or 0
result.deferred_replacement_count = unchanged_count
local pattern_ok<const>, pattern_error<const> = pcall(string.match, 'x', '[')
local capture_ok<const>, capture_error<const> = pcall(string.match, 'x', '%1')
local replacement_ok<const>, replacement_error<const> =
	pcall(string.gsub, 'x', 'x', false)
result.invalid_pattern_error = not pattern_ok
	and pattern_error == 'invalid string pattern' and 1 or 0
result.invalid_capture_error = not capture_ok
	and capture_error == 'invalid string pattern capture' and 1 or 0
result.invalid_replacement_error = not replacement_ok
	and replacement_error ==
		'string.gsub replacement must be a string, number, function, or table.'
	and 1 or 0
print('Pattern deferred errors', limited, limited_count, unchanged,
	unchanged_count)
print('Pattern syntax error', pattern_ok, pattern_error)
print('Pattern capture error', capture_ok, capture_error)
print('Pattern replacement error', replacement_ok)
print(replacement_error)

result.completed = 1
while true do
	halt_until_irq
end
```

#### Pattern observations

The supplied retained-result check waits for completion and checks 40
assertions, including all comparison words, the three iterator codepoints,
counts and positions. Independent ordinary playback produced the following
13 diagnostic lines. Values separated by tabs are separate `print` arguments;
the final replacement-error payload is printed on its own line.

```text
Pattern positions	2	2	1	1	4	3	3
Pattern captures	ship_17	12	-3	5	42
Pattern end search	1	0
Pattern iteration	3	99	100	115	3
Pattern atoms	a1b2b	a1b	(a(b)c)	cat	go	1
Pattern replacement text	[red] [blue]	2	false blue	2
Pattern replacement callback	red B	2	2
Pattern replacement empty	____	4
Pattern deferred errors	x	0	x	0
Pattern syntax error	false	invalid string pattern
Pattern capture error	false	invalid string pattern capture
Pattern replacement error	false
string.gsub replacement must be a string, number, function, or table.
```

These are observed results for this program, not a universal malformed-input,
resource, cycle-budget or all-implementation guarantee. The zero-limit and
unmatched cases demonstrate deferred checks; they do not make false a valid
replacement once evaluation is reached.

## String packet packing

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
collections use the [CPU's maintained Table lengths](cpu.md#stored-length),
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

This example describes the calls and result bindings; it is not an executed-output listing.

### Packet units are String codepoints

BLua String lengths and positions count Unicode codepoints, not UTF-8 bytes. This also applies to packing formats and packets. In this section, a **packet unit** means one String codepoint.

Numeric fields and padding written by `pack` contain codepoints in the range 0–255. Text fields copy their source codepoints without imposing that range. Consequently, a packed String is not necessarily a sequence of octets, and it is not a mapped byte buffer or an address.

`unpack` reads numeric digits as codepoint values. It neither checks that a digit is at most 255 nor masks it to eight bits. A text field containing a larger codepoint can therefore affect a later numeric interpretation.

As a calculation from these rules, `string.pack("c1", string.char(256))` copies codepoint 256 into one packet unit. Reading that one-unit String with `B` accumulates the Number 256; reading it with `b` applies the signed subtraction once and obtains 0. In either calculation the next position is 2. These are consequences of the codepoint representation, not octet-storage behavior.

A cartridge that needs mapped-memory bytes must transfer or convert the String using a separately specified interface. These functions define no address allocation, pointer convention, or String-to-mapped-memory transfer.

### Formats

Each call begins in little-endian order with maximum alignment 8. `pack` and `packsize` start at zero-based offset 0. `unpack` begins at the source offset selected by `pos`.

Only the following whitespace is ignored between format tokens: space and codepoints 9–13. A numeric suffix consists of consecutive ASCII decimal digits. There is no sign, decimal point, separator, or internal whitespace in a suffix. The suffix reader has no general digit-count or numeric upper bound; the individual options below impose their own restrictions.

<section class="keep-together">

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

</section>

`[N]` marks an optional suffix in this table; the square brackets are not format characters. The `f`, `d`, `n`, and `z` options do not read a width suffix. `cN` has no parser-imposed maximum width.

| Control | Effect |
| --- | --- |
| `<` | Select little-endian numeric order. |
| `>` | Select big-endian numeric order. |
| `=` | Select the fixed default: little-endian order. |
| `!N` | Set maximum alignment to positive decimal `N`. The suffix is required. It need not be a power of two; there is no upper-bound check in this control. |

Controls consume neither packet units nor arguments and return no data values. Every other option is unsupported. Parsing and field processing are interleaved; there is no separate up-front format-validation pass.

#### Alignment and padding

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

As calculations from the table and padding formula, `string.packsize("!1bT")` is 8, and `string.packsize("bXc3")` is 6. A trailing `X` adds no padding.

### Integer fields

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

Thus an ordinary octet-valued seven- or eight-unit representation with its sign bit set is rejected before it can become a negative result: its unsigned value is at least `2^55` or `2^63`, respectively. As a source-derived calculation, eight codepoints of value 255 read with `j` reach the safe-integer error rather than returning −1. Packing −1 with `j` is likewise not a promise of an exact all-255 representation: it first performs the Number addition `-1 + 2^64`.

### Text fields

Text widths and lengths are codepoint counts. Embedded zero codepoints are ordinary String content except where `z` explicitly forbids or terminates them.

#### `cN`: fixed width

`pack` copies the first `N` codepoints. It truncates longer input without error and pads shorter input with zero codepoints. There is no automatic field alignment.

`c0` still consumes one argument but performs no input-length operation and writes no field data.

`unpack` returns exactly the selected `N`-unit substring, including zero codepoints, then advances by `N`. On a String source, `c0` returns an empty String.

#### `z`: zero terminated

`pack` scans the complete input. A zero codepoint anywhere in it causes `string.pack z strings must not contain zero bytes.` Otherwise it copies the content and appends one zero terminator. The error says “bytes”; the scan itself compares codepoints to zero.

`unpack` searches for the first zero codepoint, returns the preceding content, and advances past the terminator. If no terminator is found within the source, it reports the zero-terminated-string error.

#### `s[N]`: length prefixed

`pack` aligns the prefix, writes the content's codepoint count as an unsigned integer of the selected prefix width, then copies the entire content. The prefix uses the current endian order and the integer packing checks. Zero codepoints in the content are permitted.

`unpack` reads the unsigned prefix, checks that the indicated content span fits, returns exactly that span, and advances past both prefix and content. Zero codepoints are preserved.

`packsize` rejects both `z` and `s` immediately when it reaches them, regardless of any intended content.

### Floating-point fields

`f` uses a four-unit field; `d` and `n` use eight-unit fields. These are specific Number-to-field transformations. Their widths and field names are not a guarantee of correctly rounded IEEE 754 serialization for every Number.

The following equations specify the transformations, including their subnormal branch. They are calculations defining the interface, not measured sample outputs. `//` denotes BLua floor division.

#### Encoding

Use these field parameters:

| Field | Exponent bits `E` | Mantissa bits `M` | Bias `B = 2^(E-1)-1` | Scale `S = 2^M` |
| --- | ---: | ---: | ---: | ---: |
| `f` | 8 | 23 | 127 | `2^23` |
| `d`, `n` | 11 | 52 | 1023 | `2^52` |

Let `emax = 2^E - 1`. The sign starts at 0 and becomes 1 only when the input is less than zero; the input is then negated. A negative-zero Number is not distinguished by that comparison.

- NaN selects exponent `emax` and mantissa 1.
- Infinity selects exponent `emax` and mantissa 0.
- Zero leaves both exponent and mantissa at 0.
- For other finite, nonzero input, start with exponent 0. Repeatedly divide the value by 2 while it is at least 2, incrementing the exponent; repeatedly multiply it by 2 while it is less than 1, decrementing the exponent. Then add the bias to the exponent. In the equations below, `v` is that normalized value and `e` is that biased exponent.

```text
if e <= 0:
    m = ((v / 2^(1 - e - B)) * S + 0.5) // 1
    e = 0
else if e >= emax:
    m = 0
    e = emax
else:
    m = ((v - 1) * S + 0.5) // 1
    if m >= S:
        m = 0
        e = e + 1
```

There is no further correction or range check after that last exponent increment. In particular, the subnormal equation above must not be replaced with a presumed standard-encoding rule.

For `f`, the numeric word passed to the digit writer is:

```text
sign * 2^31 + e * 2^23 + m
```

Four digits are written in the selected order. For `d` and `n`, the two words are:

```text
high = sign * 2^31 + e * 2^20 + (m // 2^32)
low  = m % 2^32
```

Little-endian fields write `low` as four little-endian digits, then `high` likewise. Big-endian fields write `high` as four big-endian digits, then `low` likewise.

Unlike the integer path, floating-point packing has no argument-type validation. With the standard globals unchanged, a nonnumeric argument such as nil or a numeric String reaches NaN arithmetic and produces four or eight zero codepoints through the digit writer and `string.char`. This is a source-derived consequence, not an integer-validation error. A Number NaN instead takes the explicit NaN branch above.

#### Decoding

`f` reads one four-unit word as `high` and supplies `low = 0`. `d` and `n` read the two four-unit words in the inverse order of encoding.

<section class="keep-together">

The sign multiplier is −1 when `high >= 2^31`, otherwise 1. Extract the fields as follows:

```text
f:
    e = (high // 2^23) % 2^8
    m = high % 2^23

d, n:
    e = (high // 2^20) % 2^11
    m = (high % 2^20) * 2^32 + low
```

</section>

Using that field's `B`, `S`, and `emax`:

```text
e == emax and m == 0:  sign / 0
e == emax and m ~= 0:  0 / 0
e == 0:               sign * (m / S) * 2^(1 - B)
otherwise:            sign * (1 + m / S) * 2^(e - B)
```

There is no additional source-digit or encoding validation. Do not infer NaN-payload preservation, exhaustive rounding behavior, or interchange compatibility beyond these transformations.

### Unpack positions, bounds, and results

`pos` defaults to 1 when absent or nil. Otherwise `pos // 1` supplies the starting position; the zero-based offset is that result minus 1. Fractional finite Numbers therefore round down here. Negative positions are **not** relative to the source's end.

For an ordinary numeric starting position, the accepted interval is 1 through `#packet + 1`, inclusive. The final position can serve an empty/control-only or zero-width format, but cannot supply packet data. A position outside the interval causes `string.unpack start index out of range.`

Alignment remains relative to the absolute source offset. A packet packed at offset 0 is therefore not automatically aligned the same way when unpacked from an arbitrary interior position.

The position argument has no Number-category or integer check. A nonnumeric value or NaN becomes NaN through `//`, evades the range comparisons, and is not repaired. For example, as a calculation from the position rules, an empty format and String source with a numeric String position produce NaN as the only next-position result. Either infinity fails the explicit range check.

Before reading or skipping `x`, `X`, integer, float, fixed-width text, length-prefix, or prefixed-content spans, `unpack` checks whether the needed span extends beyond the source. Such a failure reports `string.unpack string is too short.` The `z` scan instead has its own missing-terminator error. Earlier processing is not rolled back when a later field fails.

Successful unpacking need not consume the whole String: trailing content is allowed. The final result is the **next one-based codepoint position**, not the number of units consumed. It can be passed as the next call's `pos`, provided the desired absolute-offset alignment is retained:

```lua
local first, next_pos = string.unpack("<I2", packet)
local tag, after_tag = string.unpack("c4", packet, next_pos)
```

<section class="keep-together">

### Argument categories and library dependencies

There is no common up-front String-category check for formats, text operands, or sources. The operations actually reached determine which categories are accepted. In particular, `#` accepts Strings and Tables, while `string.byte` requires a String.

Some branches can therefore process a Table before reaching any operation requiring a String:

- A format Table whose length is zero bypasses token reads; a positive-length format Table reaches `string.byte` and fails its String requirement.
- `c0` can consume even an argument with no supported length operation, because it never requests that length.
- A Table input with length zero can supply padding to `cN`, an empty payload to `s`, or only the terminator to `z`.
- A substring covering an operand's entire span can return the original Table. Later concatenation then uses the current global `tostring` for it rather than necessarily producing an early String-category error.
- A Table source can pass through control/padding-only unpacking without byte access. A full-span `cN` substring can likewise return the Table itself.

</section>

These accepted branches use the CPU's maintained-length rule. They must not be described as a blanket rejection of all non-String inputs or generalized into a separate String-specific Table-length specification.

The packing functions retain the `string.byte`, `string.char`, `string.sub`, `table.concat`, and `table.unpack` functions, and their float conversion functions, selected when the String library is initialized. Replacing those public Table entries afterward does not replace the retained functions.

This does not freeze every dependency. Argument selection uses the current global `select`, and directly reported errors use the current global `error`. The retained concatenation operation uses current global `tostring` for non-nil singleton entries. The retained Table-unpack operation uses current global `select` for an empty selected range; a normally completed `string.unpack` result collection is not empty because it includes the next-position result. The behaviors described above assume those globals retain their standard meanings.

<section class="keep-together">

### Errors

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

</section>

Unsupported length operations and faults in the shared String operations retain those operations' own errors; they are not all converted into one of the messages above. Because parsing and data processing are interleaved, including `X` lookahead, an error does not imply that no earlier work occurred.

### Work and interface boundaries

These are ordinary BIOS function calls, not register banks. They define no per-function register addresses, reset values, interrupt sources, latched device state, or dedicated save-state words.

The functions repeatedly call String byte/substring operations, construct temporary Tables and Strings, and concatenate or expand result collections. Indexed byte access scans from the String's beginning. Integer conversion adds digit loops; floating-point encoding adds normalization loops. Table concatenation and result expansion also perform their own work.

Each String Byte/Char builtin call has an incremental cycle surcharge of 2, with no argument/result-count coefficient. That is not the full cost of these function calls and does not define a physical transfer rate. No fixed whole-call cycle total, general record/format-size limit, heap/stack budget, or arbitrary-input termination bound is specified here. In particular, the absence of a parser maximum for a large `cN` or `!N` suffix is not a promise that every such request completes successfully.

### Complete program: a packed record

This separate cartridge constructs a small record, checks its field layout,
unpacks the fixed header and continues from the returned next position. It
uses the installed BIOS directly, not a cartridge-defined byte codec or mapped
String-address convention. The [packing build route](../programming/getting-started.md#build-and-inspect-packed-records)
gives the complete tree, manifest and commands. Save **Packing result storage**
as `results.lua` and join the five entry parts in order, with one blank line
between adjacent parts, as `cart.lua`.

The record uses `< !4 B H > h < f d c3 s1 z`. The `!4` maximum places the
8-unit `d` field at offset 12, not 16. The fixed header occupies 23 codepoints;
the length-prefixed payload and terminated status bring the record to 33.
These are this format's sizes, not an ABI or a hardware transfer rate.

| Zero-based offset | Field | Actual content |
| --- | --- | --- |
| 0 | `B` version | 1 |
| 1 | Alignment padding | 0 |
| 2–3 | Little-endian `H` flags | 52, 18: value 4660 |
| 4–5 | Big-endian `h` delta | 254, 212: value −300 |
| 6–7 | Alignment padding | 0, 0 |
| 8–11 | Little-endian `f` sample | 0, 0, 160, 63: value 1.25 |
| 12–19 | Little-endian `d` calibration | 0, 0, 0, 0, 0, 0, 4, 192: value −2.5 |
| 20–22 | `c3` tag | `POS`, truncated from `POSITION` |
| 23 | `s1` payload prefix | Length 3 |
| 24–26 | Payload | 65, 0, 66 |
| 27–32 | `z` status | `ready` followed by 0 |

<section class="keep-together">

#### Packing result storage

The result layout contains only words. Comparison words are 1 for true and
0 for false; length, next-position and selected-codepoint words retain their
numeric observations. No String value is stored as a raw byte address.

```lua
module<const>

struct bios_pack_manual_result
	completed: word
	header_size: word
	record_length: word
	record_codepoints_match: word
	version_match: word
	flags_match: word
	delta_match: word
	sample_match: word
	calibration_match: word
	tag_match: word
	header_next: word
	header_padding_match: word
	flags_first_codepoint: word
	flags_second_codepoint: word
	delta_first_codepoint: word
	delta_second_codepoint: word
	payload_length: word
	payload_zero_codepoint: word
	payload_match: word
	status_match: word
	record_next: word
	fixed_length: word
	fixed_padding_codepoint: word
	fixed_match: word
	fixed_next: word
	wide_length: word
	wide_copied_codepoint: word
	wide_unsigned: word
	wide_signed: word
	wide_unsigned_next: word
	wide_signed_next: word
	integer_range_error: word
	zero_text_error: word
	variable_size_error: word
end

bss result: bios_pack_manual_result

return { result = result }
```

</section>

#### Packing entry, part 1: construct and check the record

The initial comparison checks all 33 codepoints, including the padding and
both endian orders. `packsize` is used only for the fixed header. The embedded
zero in the payload is content because that field uses `s1`, not `z`.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *bios_pack_manual_result = state.result

-- A small sample record. Offsets below are zero-based codepoint offsets.
-- B: version at 0; H: little-endian flags at 2, after one padding zero.
-- >h: big-endian signed delta at 4.
-- <f: sample at 8, after two padding zeros; d: calibration at 12.
-- !4 caps f/d alignment at four, although d occupies eight codepoints.
-- c3: tag at 20; no final alignment, so the fixed header occupies 23.
local header_format<const> = '< !4 B H > h < f d c3'
local record_format<const> = header_format .. ' s1 z'
local nul<const> = string.char(0)
local payload<const> = 'A' .. nul .. 'B'
local record<const> = string.pack(record_format,
	1, 4660, -300, 1.25, -2.5, 'POSITION', payload, 'ready')

-- Numeric fields and padding occupy 0..255 codepoints here. This is still
-- a String, not an address or a universal mapped-memory byte buffer.
result.header_size = string.packsize(header_format)
result.record_length = #record
result.record_codepoints_match = record == string.char(
	1, 0, 52, 18, 254, 212, 0, 0,
	0, 0, 160, 63,
	0, 0, 0, 0, 0, 0, 4, 192,
	80, 79, 83,
	3, 65, 0, 66,
	114, 101, 97, 100, 121, 0) and 1 or 0
```

#### Packing entry, part 2: unpack and continue

The header returns six fields and next position 24. Passing that position to
`s1 z` reads the remaining payload and status, then returns 34. These are
one-based positions, not consumed lengths. The padding check addresses String
positions 2, 7 and 8; the two-byte integer checks expose each field's ordering.

```lua
-- Unpack appends the next one-based source position to its field results.
-- Continue directly from that position; it is not a consumed-length count.
local version<const>, flags<const>, delta<const>, sample<const>,
	calibration<const>, tag<const>, header_next<const> =
	string.unpack(header_format, record)
local decoded_payload<const>, status<const>, record_next<const> =
	string.unpack('s1 z', record, header_next)
result.version_match = version == 1 and 1 or 0
result.flags_match = flags == 4660 and 1 or 0
result.delta_match = delta == -300 and 1 or 0
result.sample_match = sample == 1.25 and 1 or 0
result.calibration_match = calibration == -2.5 and 1 or 0
result.tag_match = tag == 'POS' and 1 or 0
result.header_next = header_next
result.record_next = record_next

result.header_padding_match = string.byte(record, 2) == 0
	and string.byte(record, 7) == 0 and string.byte(record, 8) == 0 and 1 or 0
result.flags_first_codepoint = string.byte(record, 3)
result.flags_second_codepoint = string.byte(record, 4)
result.delta_first_codepoint = string.byte(record, 5)
result.delta_second_codepoint = string.byte(record, 6)
print('Pack layout', result.header_size, result.record_length,
	result.header_next, result.record_next, result.record_codepoints_match)
print('Pack fields', version, flags, delta, sample, calibration, tag)
print('Pack endian and padding', result.flags_first_codepoint,
	result.flags_second_codepoint, result.delta_first_codepoint,
	result.delta_second_codepoint, result.header_padding_match)
```

#### Packing entry, part 3: variable and fixed text

The payload preserves its embedded zero. The terminated status returns
`ready` without its terminator. The separate short `c4` field preserves both
padding zeros when unpacked, so its returned String has length 4 and next
position 5.

```lua
-- s1 prefixes the codepoint count and preserves the payload's embedded NUL.
-- z appends a terminator; its decoded result does not include that terminator.
result.payload_length = #decoded_payload
result.payload_zero_codepoint = string.byte(decoded_payload, 2)
result.payload_match = decoded_payload == payload and 1 or 0
result.status_match = status == 'ready' and 1 or 0

-- c3 above truncated POSITION to POS. A short c4 input is instead NUL-padded;
-- unpack c4 preserves those padding codepoints in the returned String.
local decoded_fixed<const>, fixed_next<const> =
	string.unpack('c4', string.pack('c4', 'OK'))
local expected_fixed<const> = 'OK' .. nul .. nul
result.fixed_length = #decoded_fixed
result.fixed_padding_codepoint = string.byte(decoded_fixed, 3)
result.fixed_match = decoded_fixed == expected_fixed and 1 or 0
result.fixed_next = fixed_next
print('Pack text', result.payload_length, result.payload_zero_codepoint,
	result.payload_match, status, result.fixed_length,
	result.fixed_padding_codepoint, result.fixed_match, result.fixed_next)
```

#### Packing entry, part 4: codepoints are not octets

A `c1` copy preserves codepoint 256. Reading that same String as unsigned `B`
returns 256; signed `b` subtracts 256 once and returns 0. Both next positions
are 2. This intentionally exposes the representation boundary; it is not a
recipe for a mapped-memory byte ABI.

```lua
-- Text copying is codepoint-based, not an octet restriction. c1 preserves
-- codepoint 256. Integer reads use that codepoint directly: B yields 256,
-- whereas b subtracts 256 once and yields zero. Do not use this as a byte ABI.
local copied_wide<const> = string.pack('c1', string.char(256))
result.wide_unsigned, result.wide_unsigned_next = string.unpack('B', copied_wide)
result.wide_signed, result.wide_signed_next = string.unpack('b', copied_wide)
result.wide_length = #copied_wide
result.wide_copied_codepoint = string.byte(copied_wide)
print('Pack codepoints', result.wide_length, result.wide_copied_codepoint,
	result.wide_unsigned, result.wide_signed, result.wide_unsigned_next,
	result.wide_signed_next)
```

#### Packing entry, part 5: reached errors and completion

The numeric `B` pack path rejects 256 even though the previous text-copy path
preserved it. Packing the embedded-zero payload as `z` also fails. `packsize`
rejects the variable record format rather than estimating the payload. These
protected calls record the three exact error comparisons, then the program
marks completion and waits for interrupts.

```lua
-- B packing still enforces its numeric width range; it is not the same path
-- as reading an unconstrained source codepoint. z rejects embedded NULs.
-- packsize computes fixed headers, but cannot size a format containing s/z.
local integer_ok<const>, integer_error<const> =
	pcall(string.pack, 'B', 256)
local zero_ok<const>, zero_error<const> =
	pcall(string.pack, 'z', payload)
local variable_ok<const>, variable_error<const> =
	pcall(string.packsize, record_format)
result.integer_range_error = not integer_ok
	and integer_error == 'string.pack integer value out of range.'
	and 1 or 0
result.zero_text_error = not zero_ok
	and zero_error == 'string.pack z strings must not contain zero bytes.'
	and 1 or 0
result.variable_size_error = not variable_ok
	and variable_error == 'string.packsize format is variable-length.'
	and 1 or 0
print('Pack integer range', integer_ok, integer_error)
print('Pack zero text', zero_ok, zero_error)
print('Pack variable size', variable_ok, variable_error)

result.completed = 1
while true do
	halt_until_irq
end
```

#### Packing observations

The retained-result check waits for completion and checks 33 assertions.
Independent ordinary playback produced these eight diagnostic lines:

```text
Pack layout	23	33	24	34	1
Pack fields	1	4660	-300	1.25	-2.5	POS
Pack endian and padding	52	18	254	212	1
Pack text	3	0	1	ready	4	0	1	5
Pack codepoints	1	256	256	0	2	2
Pack integer range	false	string.pack integer value out of range.
Pack zero text	false	string.pack z strings must not contain zero bytes.
Pack variable size	false	string.packsize format is variable-length.
```

The final three lines are deliberate protected failures. The checked 1.25 and
−2.5 fields are exact examples, not exhaustive floating-point interchange or
rounding tests. These runs do not prove native execution or establish
arbitrary-size completion or timing bounds.
