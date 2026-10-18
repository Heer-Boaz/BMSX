module<entry>

local state<const> = require('results')
local result<const>: *loops_manual_result = state.result

-- Three state-changing calls supply start, limit and step, in that order.
local header_cursor = 0
local advance_header<const> = function()
	header_cursor += 1
	return header_cursor
end
for index = advance_header(), advance_header() + 2, advance_header() - 2 do
	result.header_count += 1
	result.header_sum += index
end
result.header_calls = header_cursor

-- Changing the source locals does not replace the retained limit and step.
local limit = 4
local stride = 1
for index = 1, limit, stride do
	result.cached_count += 1
	result.cached_sum += index
	limit = 0
	stride = 7
end
result.changed_limit = limit
result.changed_step = stride

-- Body writes affect the same variable used by the test and update.
for index = 1, 5 do
	result.forward_count += 1
	result.forward_sum += index
	index += 1
end
for index = 5, 1, -1 do
	result.reverse_count += 1
	result.reverse_sum += index
	index -= 1
end

-- Zero uses the non-positive test. The following body is not entered.
for index = 1, 3, 0 do
	result.zero_empty_count += 1
end

-- These bodies deliberately end with break, not with progress from step 0.
for index = 3, 1, 0 do
	result.zero_fixed_count += 1
	result.zero_fixed_sum += index
	if result.zero_fixed_count == 3 then
		break
	end
end
for index = 2, 2, 0 do
	result.zero_equal_count += 1
	result.zero_equal_sum += index
	if result.zero_equal_count == 2 then
		break
	end
end

print('Loops headers', result.header_calls, result.header_count,
	result.header_sum)
print('Loops cached', result.cached_count, result.cached_sum,
	result.changed_limit, result.changed_step)
print('Loops mutation', result.forward_count, result.forward_sum,
	result.reverse_count, result.reverse_sum)
print('Loops zero-empty', result.zero_empty_count)
print('Loops zero-fixed', result.zero_fixed_count, result.zero_fixed_sum)
print('Loops zero-equal', result.zero_equal_count, result.zero_equal_sum)
result.completed = 1

while true do
	halt_until_irq
end
