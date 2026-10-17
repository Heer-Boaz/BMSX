module<entry>

local state<const> = require('results')
local result<const>: *cpu_values_manual_result = state.result
local zero<const> = result.zero
local negative_zero<const> = -zero
local infinity<const> = 1 / zero
local nan<const> = zero / zero

-- Parallel one-based tables supply runtime POW operands.
local bases<const> = {
	negative_zero, negative_zero, negative_zero, -infinity,
	-infinity, -1, nan, -2, -1, -1, 2, -2,
}
local exponents<const> = {
	3, 0.5, -3, 0.5, -3, infinity, zero, 0.5,
	9007199254740991, 9007199254740992, -1074, -1075,
}
for index = 1, #bases do
	result.powers[index - 1] = bases[index] ^ exponents[index]
end
-- Reciprocal infinities distinguish the two signs of zero.
result.reciprocals[0] = 1 / result.powers[0]
result.reciprocals[1] = 1 / result.powers[1]
result.reciprocals[2] = 1 / result.powers[4]
result.reciprocals[3] = 1 / result.powers[11]

-- Text stays in language values; only comparison flags go into byte storage.
local inputs<const> = {
	-7 / 3, 1.234565, 1.234575, 123456.5, 999999, 999999.5,
	1000000, 0.0001, 0.00001, 0.00009999995, 2147483648,
	5e-324, -infinity, infinity, nan, negative_zero, zero,
	1.7976931348623157e308,
}
local expected<const> = {
	'-2.33333', '1.23456', '1.23458', '123457', '999999', '1e+06',
	'1e+06', '0.0001', '1e-05', '0.0001', '2.14748e+09',
	'4.94066e-324', '-inf', 'inf', 'nan', '-0', '0', '1.79769e+308',
}
for index = 1, #inputs do
	local text<const> = '' .. inputs[index]
	result.format_match[index - 1] = text == expected[index] and 1 or 0
	print('CPU format', index, text)
end

local values<const> = { 10, 20, 30 }
result.table_lengths[0] = #values
values[2] = nil
result.table_lengths[1] = #values
values[4] = 40
result.table_lengths[2] = #values
values[2] = 20
result.table_lengths[3] = #values
values[1] = nil
result.table_lengths[4] = #values
values[1] = 10
result.table_lengths[5] = #values
values[2] = false
result.table_lengths[6] = #values

values[0] = 90
values[negative_zero] = 91
values[-1] = 12
values[1.5] = 15
values['1'] = 16
values[false] = 17
values[true] = 18
values[nan] = 21
values[zero / zero] = 22
values[infinity] = 23
values[-infinity] = 24
result.table_lengths[7] = #values
result.table_values[0] = values[0]
result.table_values[1] = values[-1]
result.table_values[2] = values[1.5]
result.table_values[3] = values['1']
result.table_values[4] = values[false]
result.table_values[5] = values[true]
result.table_values[6] = values[nan]
result.table_values[7] = values[infinity]
result.table_values[8] = values[-infinity]
result.table_checks[0] = values[99] == nil and 1 or 0
result.table_checks[1] = values[1] == 10 and 1 or 0
result.table_checks[2] = values[2] ~= nil and not values[2] and 1 or 0
result.table_checks[3] = nan ~= nan and 1 or 0
local first_key<const> = {}
local other_key<const> = {}
values[first_key] = 31
result.table_checks[4] = values[first_key] == 31 and 1 or 0
result.table_checks[5] = values[other_key] == nil and 1 or 0
values[nan] = nil
result.table_checks[6] = values[nan] == nil and 1 or 0

-- Table-only inheritance is separate from direct mappings and writes.
local inherited<const> = { answer = 42 }
local metatable<const> = { __index = inherited }
local target<const> = {}
result.metatable_checks[0] = setmetatable(target, metatable) == target and 1 or 0
result.metatable_checks[1] = getmetatable(target) == metatable and 1 or 0
result.metatable_checks[2] = target.answer == 42 and 1 or 0
result.metatable_checks[3] = rawget(target, 'answer') == nil and 1 or 0
target.answer = 7
result.metatable_checks[4] = target.answer == 7 and inherited.answer == 42 and 1 or 0
result.metatable_checks[5] = rawset(target, 'answer', 8) == target and 1 or 0
rawset(target, 'answer', nil)
result.metatable_checks[6] =
	target.answer == 42 and rawget(target, 'answer') == nil and 1 or 0
setmetatable(target, nil)
result.metatable_checks[7] = getmetatable(target) == nil and 1 or 0
result.metatable_checks[8] = target.answer == nil and 1 or 0
setmetatable(target, { __index = function() return 99 end })
result.metatable_checks[9] = target.answer == nil and 1 or 0

print('CPU values: reciprocal signs', result.reciprocals[0], result.reciprocals[1])
print('CPU values: table length', result.table_lengths[7])
result.completed = 1
while true do
	halt_until_irq
end
