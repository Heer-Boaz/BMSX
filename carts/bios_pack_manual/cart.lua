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
