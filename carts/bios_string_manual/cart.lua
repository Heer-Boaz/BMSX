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
