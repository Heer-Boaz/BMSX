module<entry>

local state<const> = require('results')
local result<const>: *cpu_manual_result = state.result
rodata little_endian_bytes: u8[4] = { 0x78, 0x56, 0x34, 0x12 }

-- Read operands back from real numeric storage, not just constant expressions.
result.operands[0] = -7
result.operands[1] = 3
result.operands[2] = -1.75
result.operands[3] = 2147483647
result.operands[4] = 2147483648
local numerator<const> = result.operands[0]
local divisor<const> = result.operands[1]
result.quotient = numerator / divisor
result.floor_quotient = numerator // divisor
result.mod_positive = numerator % divisor
result.mod_negative = -numerator % -divisor

-- Arithmetic retains a Number; a word transfer and a bitwise result differ.
result.number_sum = result.operands[3] + 1
result.word_sum = result.number_sum
result.signed_word = result.number_sum | 0
result.shift_right = result.operands[4] >> 1
result.shift_32 = 1 << 32
result.shift_negative = 1 << -1
result.truncated_word = result.operands[2] | 0

local zero<const> = result.operands[1] - 3
if zero then
	result.zero_is_true = 1
end
result.comparison = numerator < divisor and 1 or 0

-- These are typed views of byte storage, not a cast of a string reference.
local halves<const>: *u16 = little_endian_bytes
local whole<const>: *u32 = little_endian_bytes
result.read_u16[0] = halves[0]
result.read_u16[1] = halves[1]
result.read_u32 = *whole
result.rounded = result.operands[4] + 1
result.rounded_readback = result.rounded

local add<const> = function(first, second)
	return first + second
end
local make_counter<const> = function(value)
	return function(delta)
		value = value + delta
		return value
	end
end
result.call_sum = add(numerator, divisor)
local advance<const> = make_counter(10)
result.counter[0] = advance(2)
result.counter[1] = advance(3)

print('CPU: quotient', result.quotient, 'floor', result.floor_quotient)
print('CPU: Number', result.number_sum, 'signed word', result.signed_word)
print('CPU: counter', result.counter[0], result.counter[1])
result.completed = 1
while true do
	halt_until_irq
end
