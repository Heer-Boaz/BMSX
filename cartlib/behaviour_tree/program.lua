local contract<const> = require('cartlib/behaviour_tree/contract')

-- Admission-only lowering. Standard sequence/selector programs retain their
-- running child; reactive variants explicitly restart and abort displaced
-- subtree state. Parallel programs retain terminal children. Stateful actions
-- receive one component-owned state table and an explicit halt callback. The
-- frame path allocates nothing and never resolves authored node ids or state
-- property names.

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

local allocate_state_slots<const> = function(context, count)
	local first_slot<const> = context.state_slot_count + 1
	context.state_slot_count = context.state_slot_count + count
	return first_slot
end

local return_success<const> = function()
	return result_success
end

local return_failure<const> = function()
	return result_failure
end

local create_no_execution_state<const> = function()
	return nil
end

local create_plain_execution_state<const> = function()
	return {}
end

local compile_task_state_factory<const> = function(task_state_slots)
	local task_state_count<const> = #task_state_slots
	return function()
		local execution_state<const> = {}
		for index = 1, task_state_count do
			execution_state[task_state_slots[index]] = {}
		end
		return execution_state
	end
end

local compile_subtree_resetter<const> = function(resetters, resetter_count)
	local active<const> = {}
	for index = 1, resetter_count do
		local reset<const> = resetters[index]
		if reset then
			active[#active + 1] = reset
		end
	end
	local active_count<const> = #active
	if active_count == 0 then
		return nil
	end
	if active_count == 1 then
		return active[1]
	end
	return function(target, blackboard, execution_state)
		for index = 1, active_count do
			active[index](target, blackboard, execution_state)
		end
	end
end

local compile_children<const> = function(children, context)
	local child_count<const> = #children
	local evaluators<const> = {}
	local operands<const> = {}
	local resetters<const> = {}
	for index = 1, child_count do
		local evaluate<const>, operand<const>, reset<const> = compile_node(children[index], context)
		evaluators[index] = evaluate
		operands[index] = operand
		resetters[index] = reset or false
	end
	return evaluators, operands, resetters, child_count
end

compile_by_kind[kind.sequence] = function(node, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, context)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(target, blackboard, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, blackboard, execution_state)
			end
		end
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local child_index = execution_state[state_slot] or 1
		while child_index <= child_count do
			local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
			if status ~= result_success then
				if status == result_running then
					execution_state[state_slot] = child_index
				else
					execution_state[state_slot] = nil
				end
				return status
			end
			child_index = child_index + 1
		end
		execution_state[state_slot] = nil
		return result_success
	end, nil, reset
end

compile_by_kind[kind.selector] = function(node, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, context)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(target, blackboard, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, blackboard, execution_state)
			end
		end
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local child_index = execution_state[state_slot] or 1
		while child_index <= child_count do
			local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
			if status ~= result_failure then
				if status == result_running then
					execution_state[state_slot] = child_index
				else
					execution_state[state_slot] = nil
				end
				return status
			end
			child_index = child_index + 1
		end
		execution_state[state_slot] = nil
		return result_failure
	end, nil, reset
end

compile_by_kind[kind.reactive_sequence] = function(node, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, context)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	if reset_children == nil then
		return function(target, blackboard)
			for child_index = 1, child_count do
				local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
				if status ~= result_success then
					return status
				end
			end
			return result_success
		end
	end
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(target, blackboard, execution_state)
		execution_state[state_slot] = nil
		reset_children(target, blackboard, execution_state)
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local previous_child_index<const> = execution_state[state_slot]
		for child_index = 1, child_count do
			local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
			if status ~= result_success then
				if previous_child_index ~= nil and previous_child_index ~= child_index then
					resetters[previous_child_index](target, blackboard, execution_state)
				end
				if status == result_running and resetters[child_index] then
					execution_state[state_slot] = child_index
				else
					execution_state[state_slot] = nil
				end
				return status
			end
		end
		execution_state[state_slot] = nil
		return result_success
	end, nil, reset
end

local compile_reactive_selector<const> = function(children, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, context)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	if reset_children == nil then
		return function(target, blackboard)
			for child_index = 1, child_count do
				local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
				if status ~= result_failure then
					return status
				end
			end
			return result_failure
		end
	end
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(target, blackboard, execution_state)
		execution_state[state_slot] = nil
		reset_children(target, blackboard, execution_state)
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local previous_child_index<const> = execution_state[state_slot]
		for child_index = 1, child_count do
			local status<const> = evaluators[child_index](target, blackboard, operands[child_index])
			if status ~= result_failure then
				if previous_child_index ~= nil and previous_child_index ~= child_index then
					resetters[previous_child_index](target, blackboard, execution_state)
				end
				if status == result_running and resetters[child_index] then
					execution_state[state_slot] = child_index
				else
					execution_state[state_slot] = nil
				end
				return status
			end
		end
		execution_state[state_slot] = nil
		return result_failure
	end, nil, reset
end

compile_by_kind[kind.reactive_selector] = function(node, context)
	return compile_reactive_selector(node.children, context)
end

local sort_by_priority_desc<const> = function(a, b)
	return a.priority > b.priority
end

compile_by_kind[kind.priority_selector] = function(node, context)
	local children<const> = node.children
	local child_count<const> = #children
	local ordered_children<const> = {}
	for index = 1, child_count do
		ordered_children[index] = children[index]
	end
	if child_count > 1 then
		table.sort(ordered_children, sort_by_priority_desc)
	end
	return compile_reactive_selector(ordered_children, context)
end

local compile_parallel_all<const> = function(children, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, context)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local first_state_slot<const> = allocate_state_slots(context, child_count)
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	local reset<const> = function(target, blackboard, execution_state)
		for child_index = 1, child_count do
			execution_state[first_state_slot + child_index - 1] = nil
		end
		if reset_children ~= nil then
			reset_children(target, blackboard, execution_state)
		end
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local any_running
		for child_index = 1, child_count do
			local state_slot<const> = first_state_slot + child_index - 1
			local status = execution_state[state_slot]
			if status == nil then
				status = evaluators[child_index](target, blackboard, operands[child_index])
			end
			if status ~= result_success then
				if status == result_running then
					any_running = true
				else
					reset(target, blackboard, execution_state)
					return status
				end
			else
				execution_state[state_slot] = result_success
			end
		end
		if any_running then
			return result_running
		end
		reset(target, blackboard, execution_state)
		return result_success
	end, nil, reset
end

local compile_parallel_one<const> = function(children, context)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, context)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local first_state_slot<const> = allocate_state_slots(context, child_count)
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	local reset<const> = function(target, blackboard, execution_state)
		for child_index = 1, child_count do
			execution_state[first_state_slot + child_index - 1] = nil
		end
		if reset_children ~= nil then
			reset_children(target, blackboard, execution_state)
		end
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local any_running
		for child_index = 1, child_count do
			local state_slot<const> = first_state_slot + child_index - 1
			local status = execution_state[state_slot]
			if status == nil then
				status = evaluators[child_index](target, blackboard, operands[child_index])
			end
			if status ~= result_failure then
				if status == result_running then
					any_running = true
				else
					reset(target, blackboard, execution_state)
					return status
				end
			else
				execution_state[state_slot] = result_failure
			end
		end
		if any_running then
			return result_running
		end
		reset(target, blackboard, execution_state)
		return result_failure
	end, nil, reset
end

compile_by_kind[kind.parallel_all] = function(node, context)
	return compile_parallel_all(node.children, context)
end

compile_by_kind[kind.parallel_one] = function(node, context)
	return compile_parallel_one(node.children, context)
end

compile_by_kind[kind.decorator] = function(node, context)
	local evaluate<const>, operand<const>, reset<const> = compile_node(node.child, context)
	local decorate<const> = node.decorator
	if not reset then
		return function(target, blackboard)
			return decorate(target, blackboard, evaluate(target, blackboard, operand))
		end
	end
	return function(target, blackboard)
		local status<const> = decorate(target, blackboard, evaluate(target, blackboard, operand))
		if status ~= result_running then
			reset(target, blackboard, blackboard._execution_state)
		end
		return status
	end, nil, reset
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
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, context)
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(target, blackboard, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, blackboard, execution_state)
			end
		end
	end
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
	end, nil, reset
end

compile_by_kind[kind.limit] = function(node, context)
	local evaluate<const>, operand<const>, reset_child<const> = compile_node(node.child, context)
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
	end, nil, reset_child
end

compile_by_kind[kind.wait] = function(node, context)
	local wait_time<const> = node.wait_time
	local state_slot<const> = allocate_state_slot(context)
	local reset<const> = function(_target, _blackboard, execution_state)
		execution_state[state_slot] = nil
	end
	return function(_target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local elapsed<const> = execution_state[state_slot] or 0
		if elapsed < wait_time then
			execution_state[state_slot] = elapsed + 1
			return result_running
		end
		execution_state[state_slot] = nil
		return result_success
	end, nil, reset
end

compile_by_kind[kind.action] = function(node)
	return node.action, node.parameters
end

compile_by_kind[kind.stateful_action] = function(node, context)
	local state_slot<const> = allocate_state_slot(context)
	local task_state_slots<const> = context.task_state_slots
	task_state_slots[#task_state_slots + 1] = state_slot
	local running_slot<const> = allocate_state_slot(context)
	local on_start<const> = node.on_start
	local on_running<const> = node.on_running
	local on_halted<const> = node.on_halted
	local parameters<const> = node.parameters
	local reset<const> = function(target, blackboard, execution_state)
		if execution_state[running_slot] then
			execution_state[running_slot] = nil
			on_halted(execution_state[state_slot], target, blackboard, parameters)
		end
	end
	return function(target, blackboard)
		local execution_state<const> = blackboard._execution_state
		local task_state<const> = execution_state[state_slot]
		local status
		if execution_state[running_slot] then
			status = on_running(task_state, target, blackboard, parameters)
		else
			status = on_start(task_state, target, blackboard, parameters)
		end
		if status == result_running then
			execution_state[running_slot] = true
		else
			execution_state[running_slot] = nil
		end
		return status
	end, nil, reset
end

compile_by_kind[kind.composite_action] = function(node, context)
	return compile_parallel_all(node.actions, context)
end

compile_node = function(node, context)
	return compile_by_kind[getmetatable(node).program_kind](node, context)
end

-- Authored node objects are admission input. The retained program contains
-- only the evaluator graph, immutable operands, its reset path and a factory
-- for component-owned evaluator slots and stateful-action records.
function program.compile(root)
	local context<const> = {
		state_slot_count = 0,
		task_state_slots = {},
	}
	local evaluate<const>, operand<const>, reset<const> = compile_node(root, context)
	local state_slot_count<const> = context.state_slot_count
	local task_state_slots<const> = context.task_state_slots
	local create_execution_state
	if state_slot_count == 0 then
		create_execution_state = create_no_execution_state
	elseif #task_state_slots == 0 then
		create_execution_state = create_plain_execution_state
	else
		create_execution_state = compile_task_state_factory(task_state_slots)
	end
	return {
		id = root.id,
		evaluate = evaluate,
		operand = operand,
		reset = reset,
		create_execution_state = create_execution_state,
	}
end

return program
