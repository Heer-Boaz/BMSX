local contract<const> = require('cartlib/behaviour_tree/contract')

local program<const> = {}
local kind<const> = contract.node_kind
local result<const> = contract.result
local result_running<const> = result.running
local result_success<const> = result.success
local result_failure<const> = result.failure
local compile_by_kind<const> = {}
local compile_node

local return_success<const> = function()
	return result_success
end

local return_failure<const> = function()
	return result_failure
end

local compile_children<const> = function(children)
	local child_count<const> = #children
	local evaluators<const> = {}
	local operands<const> = {}
	for index = 1, child_count do
		local evaluate<const>, operand<const> = compile_node(children[index])
		evaluators[index] = evaluate
		operands[index] = operand
	end
	return evaluators, operands, child_count
end

compile_by_kind[kind.sequence] = function(node)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1]
	end
	return function(target, blackboard)
		for index = 1, child_count do
			local status<const> = evaluators[index](target, blackboard, operands[index])
			if status ~= result_success then
				return status
			end
		end
		return result_success
	end
end

compile_by_kind[kind.selector] = function(node)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1]
	end
	return function(target, blackboard)
		for index = 1, child_count do
			local status<const> = evaluators[index](target, blackboard, operands[index])
			if status ~= result_failure then
				return status
			end
		end
		return result_failure
	end
end

compile_by_kind[kind.parallel_all] = function(node)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children)
	return function(target, blackboard)
		local any_running
		for index = 1, child_count do
			local status<const> = evaluators[index](target, blackboard, operands[index])
			if status ~= result_success then
				if status == result_running then
					any_running = true
				else
					return status
				end
			end
		end
		return any_running and result_running or result_success
	end
end

compile_by_kind[kind.parallel_one] = function(node)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children)
	return function(target, blackboard)
		local any_running
		for index = 1, child_count do
			local status<const> = evaluators[index](target, blackboard, operands[index])
			if status ~= result_failure then
				if status == result_running then
					any_running = true
				else
					return status
				end
			end
		end
		return any_running and result_running or result_failure
	end
end

compile_by_kind[kind.decorator] = function(node)
	local evaluate<const>, operand<const> = compile_node(node.child)
	local decorate<const> = node.decorator
	return function(target, blackboard)
		return decorate(target, blackboard, evaluate(target, blackboard, operand))
	end
end

compile_by_kind[kind.condition] = function(node)
	local condition<const> = node.condition
	local parameters<const> = node.parameters
	return function(target, blackboard)
		return condition(target, blackboard, parameters) and result_success or result_failure
	end
end

compile_by_kind[kind.negated_condition] = function(node)
	local condition<const> = node.condition
	local parameters<const> = node.parameters
	return function(target, blackboard)
		return condition(target, blackboard, parameters) and result_failure or result_success
	end
end

compile_by_kind[kind.composite_condition] = function(node)
	local conditions<const> = node.conditions
	local condition_count<const> = #conditions
	local parameters<const> = node.parameters
	return function(target, blackboard)
		for index = 1, condition_count do
			if not conditions[index](target, blackboard, parameters) then
				return result_failure
			end
		end
		return result_success
	end
end

compile_by_kind[kind.composite_or_condition] = function(node)
	local conditions<const> = node.conditions
	local condition_count<const> = #conditions
	local parameters<const> = node.parameters
	return function(target, blackboard)
		for index = 1, condition_count do
			if conditions[index](target, blackboard, parameters) then
				return result_success
			end
		end
		return result_failure
	end
end

compile_by_kind[kind.random_selector] = function(node)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children)
	local property_name<const> = node.current_child_property_name
	return function(target, blackboard)
		local node_data<const> = blackboard.node_data
		local child_index = node_data[property_name]
		if child_index == nil then
			child_index = math.random(1, child_count)
			node_data[property_name] = child_index
		end
		local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
		if status ~= result_running then
			node_data[property_name] = nil
		end
		return status
	end
end

compile_by_kind[kind.limit] = function(node)
	local evaluate<const>, operand<const> = compile_node(node.child)
	local limit<const> = node.limit
	local property_name<const> = node.count_property_name
	return function(target, blackboard)
		local node_data<const> = blackboard.node_data
		local count<const> = node_data[property_name] or 0
		if count < limit then
			local status<const> = evaluate(target, blackboard, operand)
			if status ~= result_running then
				node_data[property_name] = count + 1
			end
			return status
		end
		return result_failure
	end
end

compile_by_kind[kind.wait] = function(node)
	local wait_time<const> = node.wait_time
	local property_name<const> = node.wait_property_name
	return function(_target, blackboard)
		local node_data<const> = blackboard.node_data
		local elapsed<const> = node_data[property_name] or 0
		if elapsed < wait_time then
			node_data[property_name] = elapsed + 1
			return result_running
		end
		node_data[property_name] = nil
		return result_success
	end
end

compile_by_kind[kind.action] = function(node)
	return node.action, node.parameters
end

compile_by_kind[kind.composite_action] = function(node)
	local evaluators<const>, operands<const>, action_count<const> = compile_children(node.actions)
	return function(target, blackboard)
		local outcome
		for index = 1, action_count do
			local status<const> = evaluators[index](target, blackboard, operands[index])
			if status == result_failure then
				return status
			end
			if status == result_running then
				outcome = status
			end
		end
		return outcome or result_success
	end
end

compile_node = function(node)
	return compile_by_kind[getmetatable(node).program_kind](node)
end

-- Authored node objects are admission input. The retained program contains
-- only the evaluator graph and its immutable operands; every component keeps
-- its own mutable blackboard.
function program.compile(root)
	local evaluate<const>, operand<const> = compile_node(root)
	return {
		id = root.id,
		evaluate = evaluate,
		operand = operand,
	}
end

return program
