local result<const> = require('cartlib/behaviour_tree/result')

-- Blackboard key names and operations are resolved while a tree is admitted.
-- Evaluators retain only dense slots and specialized comparison closures; the
-- frame path performs no string lookup or authored-definition dispatch.

local blackboard_program<const> = {}
local result_success<const> = result.success
local result_failure<const> = result.failure
local compile_test_by_operation<const> = {}

compile_test_by_operation.equal = function(slot, value)
	return function(values)
		return values[slot] == value
	end
end

compile_test_by_operation.not_equal = function(slot, value)
	return function(values)
		return values[slot] ~= value
	end
end

compile_test_by_operation.less = function(slot, value)
	return function(values)
		return values[slot] < value
	end
end

compile_test_by_operation.less_or_equal = function(slot, value)
	return function(values)
		return values[slot] <= value
	end
end

compile_test_by_operation.greater = function(slot, value)
	return function(values)
		return values[slot] > value
	end
end

compile_test_by_operation.greater_or_equal = function(slot, value)
	return function(values)
		return values[slot] >= value
	end
end

compile_test_by_operation.is_set = function(slot)
	return function(values)
		return values[slot] ~= nil
	end
end

compile_test_by_operation.is_not_set = function(slot)
	return function(values)
		return values[slot] == nil
	end
end

local compile_test<const> = function(definition, layout)
	local slot<const> = layout.blackboard_layout.slots_by_key[definition.key]
	return compile_test_by_operation[definition.operation](slot, definition.value)
end

function blackboard_program.compile_set(node, layout)
	local slot<const> = layout.blackboard_layout.slots_by_key[node.key]
	local value<const> = node.value
	return function(_target, execution)
		execution.blackboard:_set_slot(slot, value)
		return result_success
	end
end

function blackboard_program.compile_add(node, layout)
	local slot<const> = layout.blackboard_layout.slots_by_key[node.key]
	local value<const> = node.value
	return function(_target, execution)
		local blackboard<const> = execution.blackboard
		local values<const> = blackboard._values
		blackboard:_set_slot(slot, values[slot] + value)
		return result_success
	end
end

function blackboard_program.compile_decorators(definitions, layout, evaluate, operand, reset)
	local count<const> = #definitions
	local tests<const> = {}
	for index = 1, count do
		tests[index] = compile_test(definitions[index], layout)
	end
	if count == 1 then
		local test<const> = tests[1]
		if reset == nil then
			return function(target, execution)
				if test(execution.blackboard._values) then
					return evaluate(target, execution, operand)
				end
				return result_failure
			end
		end
		return function(target, execution)
			if test(execution.blackboard._values) then
				return evaluate(target, execution, operand)
			end
			reset(target, execution, execution._execution_state)
			return result_failure
		end, nil, reset
	end
	if reset == nil then
		return function(target, execution)
			local values<const> = execution.blackboard._values
			for index = 1, count do
				if not tests[index](values) then
					return result_failure
				end
			end
			return evaluate(target, execution, operand)
		end
	end
	return function(target, execution)
		local values<const> = execution.blackboard._values
		for index = 1, count do
			if not tests[index](values) then
				reset(target, execution, execution._execution_state)
				return result_failure
			end
		end
		return evaluate(target, execution, operand)
	end, nil, reset
end

return blackboard_program
