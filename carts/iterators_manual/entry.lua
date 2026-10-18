module<entry>

local storage<const> = require('results')
local result<const>: *iterators_manual_result = storage.result

local context<const> = { calls = 0 }
local iterator<const> = function(state, control)
	state.calls += 1
	if state.calls == 1 then
		result.first_control = control
		return false, 10
	elseif state.calls == 2 then
		result.second_control_false = control ~= nil and not control and 1 or 0
		return 2, 20
	end
	result.third_control = control
	result.stop_payload = 999
	return nil, 999
end

for key, value, missing in iterator, context, 0 do
	result.body_count += 1
	result.payload_sum += value
	if not key then
		result.false_key_count += 1
	end
	if missing == nil then
		result.missing_third_count += 1
	end
	key = 99
	result.visible_after_write += key
end
result.iterator_calls = context.calls

print('Iter calls', result.iterator_calls, result.body_count, result.payload_sum)
print('Iter controls', result.first_control, result.second_control_false,
	result.third_control)
print('Iter values', result.false_key_count, result.missing_third_count,
	result.visible_after_write, result.stop_payload)
result.completed = 1

while true do
	halt_until_irq
end
