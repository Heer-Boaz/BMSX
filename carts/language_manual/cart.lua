module<entry>

local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *language_manual_result = state.result

-- Device payloads are byte storage, not string references.
rodata utf8_bytes: u8[8] = { 0x41, 0xc3, 0xa9, 0, 0xf0, 0x9f, 0x99, 0x82 }

-- Passing this address selects existing storage; it allocates no pointee bytes.
local write_pair<const> = function(address, first, second)
	local destination<const>: *word = address
	destination[0] = first
	destination[1] = second
	return first + second, 2
end

local next_and_value<const> = function(first, value)
	return first + 1, value
end
local tail<const> = function(head, ...)
	return head, select('#', ...), ...
end
local empty<const> = function()
	return
end
local pair<const> = function()
	return 11, 22
end
local make_counter<const> = function(value)
	return function(delta)
		value = value + delta
		return value
	end
end

result.sum, result.written_count = write_pair(&result.written[0], 17, 25)
local missing
result.argument_next[0], missing = next_and_value(4)
result.missing_is_nil = missing == nil and 1 or 0
result.argument_next[1], result.second_with_extra = next_and_value(4, 2, 3)
result.head, result.extra_count, result.extra[0], result.extra[1] = tail(7, 8, 9)
result.bare_return_count = select('#', empty())
result.bare_return_is_nil = empty() == nil and 1 or 0
-- Cartridge-source parentheses do not force this call to one result.
result.parenthesized[0], result.parenthesized[1] = (pair())

local values<const> = { 11, 22 }
local alias<const> = values
alias[1] = 33
result.table_alias_value = values[1]
result.table_zero_is_nil = values[0] == nil and 1 or 0
local advance<const> = make_counter(10)
result.counter_values[0] = advance(2)
result.counter_values[1] = advance(3)

-- Decode a complete mapped UTF-8 span with the installed string library.
local text<const> = string.from_utf8(utf8_bytes, #utf8_bytes)
result.utf8_byte_count = #utf8_bytes
result.text_length = #text
for index = 0, 3 do
	result.codepoints[index] = string.byte(text, index + 1)
end
result.constructed_matches = string.char(0x41, 0xe9, 0, 0x1f642) == text and 1 or 0
local escaped<const> = '\xc3\xa9'
result.escape_length = #escaped
result.escape_codepoints[0] = string.byte(escaped, 1)
result.escape_codepoints[1] = string.byte(escaped, 2)
result.past_end_is_nil = string.byte(text, 5) == nil and 1 or 0
result.zero_index_is_nil = string.byte(text, 0) == nil and 1 or 0

-- A linked BIOS call returns values; it is not a raw function-pointer cast.
result.system_origin, result.system_size = system_vram_region()
result.completed = 1

while true do
	halt_until_irq
end
