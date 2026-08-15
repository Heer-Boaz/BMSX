local contract<const> = require('cartlib/behaviour_tree/contract')

local program<const> = {}
local kind<const> = contract.node_kind
local result<const> = contract.result
local result_running<const> = result.running
local result_success<const> = result.success
local result_failure<const> = result.failure
local compile_by_kind<const> = {}
local compile_node

local allocate_state_slot<const> = function(context)
	local slot<const> = context.state_slot_count + 1
	context.state_slot_count = slot
	return slot
end

local return_success<const> = function()
	return result_success
end

local return_failure<const> = function()
	return result_failure
end

local compile_children<const> = function(children, context)
	local child_count<const> = #children
	local evaluators<const> = {}
	local operands<const> = {}
	for index = 1, child_count do
		local evaluate<const>, operand<const> = compile_node(children[index], context)
		evaluators[index] = evaluate
		operands[index] = operand
	end
	return evaluators, operands, child_count
end

compile_by_kind[kind.sequence] = function(node, context)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children, context)
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

compile_by_kind[kind.selector] = function(node, context)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children, context)
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

compile_by_kind[kind.parallel_all] = function(node, context)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children, context)
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

compile_by_kind[kind.parallel_one] = function(node, context)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children, context)
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

compile_by_kind[kind.decorator] = function(node, context)
	local evaluate<const>, operand<const> = compile_node(node.child, context)
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

compile_by_kind[kind.random_selector] = function(node, context)
	local evaluators<const>, operands<const>, child_count<const> = compile_children(node.children, context)
	local state_slot<const> = allocate_state_slot(context)
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local child_index = execution_state[state_slot]
		if child_index == nil then
			child_index = math.random(1, child_count)
			execution_state[state_slot] = child_index
		end
		local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
		if status ~= result_running then
			execution_state[state_slot] = nil
		end
		return status
	end
end

compile_by_kind[kind.limit] = function(node, context)
	local evaluate<const>, operand<const> = compile_node(node.child, context)
	local limit<const> = node.limit
	local state_slot<const> = allocate_state_slot(context)
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local count<const> = execution_state[state_slot] or 0
		if count < limit then
			local status<const> = evaluate(target, blackboard, operand)
			if status ~= result_running then
				execution_state[state_slot] = count + 1
			end
			return status
		end
		return result_failure
	end
end

compile_by_kind[kind.wait] = function(node, context)
	local wait_time<const> = node.wait_time
	local state_slot<const> = allocate_state_slot(context)
	return function(_target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local elapsed<const> = execution_state[state_slot] or 0
		if elapsed < wait_time then
			execution_state[state_slot] = elapsed + 1
			return result_running
		end
		execution_state[state_slot] = nil
		return result_success
	end
end

compile_by_kind[kind.action] = function(node)
	return node.action, node.parameters
end

compile_by_kind[kind.composite_action] = function(node, context)
	local evaluators<const>, operands<const>, action_count<const> = compile_children(node.actions, context)
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

compile_node = function(node, context)
	return compile_by_kind[getmetatable(node).program_kind](node, context)
end

-- Authored node objects are admission input. The retained program contains
-- only the evaluator graph, immutable operands and its runtime-slot count.
-- Components own both their action blackboard and private evaluator slots.
function program.compile(root)
	local context<const> = { state_slot_count = 0 }
	local evaluate<const>, operand<const> = compile_node(root, context)
	return {
		id = root.id,
		evaluate = evaluate,
		operand = operand,
		state_slot_count = context.state_slot_count,
	}
end

return program
