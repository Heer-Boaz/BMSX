local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local blackboard_program<const> = require('cartlib/behaviour_tree/blackboard_program')
local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')
local service_program<const> = require('cartlib/behaviour_tree/service_program')
local task_program<const> = require('cartlib/behaviour_tree/task_program')

-- Admission-only lowering. Standard sequence/selector programs retain their
-- running child; reactive variants explicitly restart and abort displaced
-- subtree state. Parallel programs retain terminal children. Tasks requesting
-- node memory receive one component-owned state table; services retain their
-- branch-scoped scheduling state; blackboard selectors resolve to dense slots.
-- Abort behavior is specialized while compiling the definition. The frame
-- path allocates nothing and never interprets definitions or resolves keys.

local program<const> = {}
local result_running<const> = result.running
local result_success<const> = result.success
local result_failure<const> = result.failure
local compile_by_type<const> = {}
local compile_node

local allocate_state_slot<const> = execution_layout.allocate_slot
local allocate_state_slots<const> = execution_layout.allocate_slots

local return_success<const> = function()
	return result_success
end

local return_failure<const> = function()
	return result_failure
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
	return function(target, execution, execution_state)
		for index = 1, active_count do
			active[index](target, execution, execution_state)
		end
	end
end

local compile_children<const> = function(children, layout)
	local child_count<const> = #children
	local evaluators<const> = {}
	local operands<const> = {}
	local resetters<const> = {}
	for index = 1, child_count do
		local evaluate<const>, operand<const>, reset<const> = compile_node(children[index], layout)
		evaluators[index] = evaluate
		operands[index] = operand
		resetters[index] = reset or false
	end
	return evaluators, operands, resetters, child_count
end

compile_by_type.sequence = function(node, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, layout)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, execution, execution_state)
			end
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local child_index = execution_state[state_slot] or 1
		while child_index <= child_count do
			local status<const> = evaluators[child_index](target, execution, operands[child_index])
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

compile_by_type.selector = function(node, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, layout)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, execution, execution_state)
			end
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local child_index = execution_state[state_slot] or 1
		while child_index <= child_count do
			local status<const> = evaluators[child_index](target, execution, operands[child_index])
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

compile_by_type.reactive_sequence = function(node, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(node.children, layout)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	if reset_children == nil then
		return function(target, execution)
			for child_index = 1, child_count do
				local status<const> = evaluators[child_index](target, execution, operands[child_index])
				if status ~= result_success then
					return status
				end
			end
			return result_success
		end
	end
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		execution_state[state_slot] = nil
		reset_children(target, execution, execution_state)
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local previous_child_index<const> = execution_state[state_slot]
		for child_index = 1, child_count do
			local status<const> = evaluators[child_index](target, execution, operands[child_index])
			if status ~= result_success then
				if previous_child_index ~= nil and previous_child_index ~= child_index then
					resetters[previous_child_index](target, execution, execution_state)
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

local compile_reactive_selector<const> = function(children, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, layout)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	if reset_children == nil then
		return function(target, execution)
			for child_index = 1, child_count do
				local status<const> = evaluators[child_index](target, execution, operands[child_index])
				if status ~= result_failure then
					return status
				end
			end
			return result_failure
		end
	end
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		execution_state[state_slot] = nil
		reset_children(target, execution, execution_state)
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local previous_child_index<const> = execution_state[state_slot]
		for child_index = 1, child_count do
			local status<const> = evaluators[child_index](target, execution, operands[child_index])
			if status ~= result_failure then
				if previous_child_index ~= nil and previous_child_index ~= child_index then
					resetters[previous_child_index](target, execution, execution_state)
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

compile_by_type.reactive_selector = function(node, layout)
	return compile_reactive_selector(node.children, layout)
end

local sort_by_priority_desc<const> = function(a, b)
	return a.priority > b.priority
end

compile_by_type.priority_selector = function(node, layout)
	local children<const> = node.children
	local child_count<const> = #children
	local ordered_children<const> = {}
	for index = 1, child_count do
		ordered_children[index] = children[index]
	end
	if child_count > 1 then
		table.sort(ordered_children, sort_by_priority_desc)
	end
	return compile_reactive_selector(ordered_children, layout)
end

local compile_parallel_all<const> = function(children, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, layout)
	if child_count == 0 then
		return return_success
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local first_state_slot<const> = allocate_state_slots(layout, child_count)
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	local reset<const> = function(target, execution, execution_state)
		for child_index = 1, child_count do
			execution_state[first_state_slot + child_index - 1] = nil
		end
		if reset_children ~= nil then
			reset_children(target, execution, execution_state)
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local any_running
		for child_index = 1, child_count do
			local state_slot<const> = first_state_slot + child_index - 1
			local status = execution_state[state_slot]
			if status == nil then
				status = evaluators[child_index](target, execution, operands[child_index])
			end
			if status ~= result_success then
				if status == result_running then
					any_running = true
				else
					reset(target, execution, execution_state)
					return status
				end
			else
				execution_state[state_slot] = result_success
			end
		end
		if any_running then
			return result_running
		end
		reset(target, execution, execution_state)
		return result_success
	end, nil, reset
end

local compile_parallel_one<const> = function(children, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, layout)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local first_state_slot<const> = allocate_state_slots(layout, child_count)
	local reset_children<const> = compile_subtree_resetter(resetters, child_count)
	local reset<const> = function(target, execution, execution_state)
		for child_index = 1, child_count do
			execution_state[first_state_slot + child_index - 1] = nil
		end
		if reset_children ~= nil then
			reset_children(target, execution, execution_state)
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local any_running
		for child_index = 1, child_count do
			local state_slot<const> = first_state_slot + child_index - 1
			local status = execution_state[state_slot]
			if status == nil then
				status = evaluators[child_index](target, execution, operands[child_index])
			end
			if status ~= result_failure then
				if status == result_running then
					any_running = true
				else
					reset(target, execution, execution_state)
					return status
				end
			else
				execution_state[state_slot] = result_failure
			end
		end
		if any_running then
			return result_running
		end
		reset(target, execution, execution_state)
		return result_failure
	end, nil, reset
end

compile_by_type.parallel_all = function(node, layout)
	return compile_parallel_all(node.children, layout)
end

compile_by_type.parallel_one = function(node, layout)
	return compile_parallel_one(node.children, layout)
end

compile_by_type.decorator = function(node, layout)
	local evaluate<const>, operand<const>, reset<const> = compile_node(node.child, layout)
	local decorate<const> = node.decorator
	if not reset then
		return function(target, execution)
			return decorate(target, execution, evaluate(target, execution, operand))
		end
	end
	return function(target, execution)
		local status<const> = decorate(target, execution, evaluate(target, execution, operand))
		if status ~= result_running then
			reset(target, execution, execution._execution_state)
		end
		return status
	end, nil, reset
end

compile_by_type.condition = function(node)
	local condition<const> = node.condition
	local parameters<const> = node.parameters
	return function(target, execution)
		return condition(target, execution, parameters) and result_success or result_failure
	end
end

compile_by_type.negated_condition = function(node)
	local condition<const> = node.condition
	local parameters<const> = node.parameters
	return function(target, execution)
		return condition(target, execution, parameters) and result_failure or result_success
	end
end

compile_by_type.composite_condition = function(node)
	local conditions<const> = node.conditions
	local condition_count<const> = #conditions
	local parameters<const> = node.parameters
	return function(target, execution)
		for index = 1, condition_count do
			if not conditions[index](target, execution, parameters) then
				return result_failure
			end
		end
		return result_success
	end
end

compile_by_type.composite_or_condition = function(node)
	local conditions<const> = node.conditions
	local condition_count<const> = #conditions
	local parameters<const> = node.parameters
	return function(target, execution)
		for index = 1, condition_count do
			if conditions[index](target, execution, parameters) then
				return result_success
			end
		end
		return result_failure
	end
end

local compile_random_children<const> = function(children, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> = compile_children(children, layout)
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		local child_index<const> = execution_state[state_slot]
		execution_state[state_slot] = nil
		if child_index ~= nil then
			local reset_child<const> = resetters[child_index]
			if reset_child then
				reset_child(target, execution, execution_state)
			end
		end
	end
	return evaluators, operands, child_count, state_slot, reset
end

compile_by_type.random_selector = function(node, layout)
	local evaluators<const>, operands<const>, child_count<const>, state_slot<const>, reset<const> =
		compile_random_children(node.children, layout)
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local child_index = execution_state[state_slot]
		if child_index == nil then
			child_index = math.random(1, child_count)
			execution_state[state_slot] = child_index
		end
		local status<const> = evaluators[child_index](target, execution, operands[child_index])
		if status ~= result_running then
			execution_state[state_slot] = nil
		end
		return status
	end, nil, reset
end

compile_by_type.weighted_random_selector = function(node, layout)
	local choices<const> = node.choices
	local child_count<const> = #choices
	local children<const> = {}
	local cumulative_weights<const> = {}
	local total_weight = 0
	for index = 1, child_count do
		local choice<const> = choices[index]
		total_weight = total_weight + choice.weight
		children[index] = choice.child
		cumulative_weights[index] = total_weight
	end
	local evaluators<const>, operands<const>, _<const>, state_slot<const>, reset<const> =
		compile_random_children(children, layout)
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local child_index = execution_state[state_slot]
		if child_index == nil then
			local roll<const> = math.random(1, total_weight)
			child_index = 1
			while roll > cumulative_weights[child_index] do
				child_index = child_index + 1
			end
			execution_state[state_slot] = child_index
		end
		local status<const> = evaluators[child_index](target, execution, operands[child_index])
		if status ~= result_running then
			execution_state[state_slot] = nil
		end
		return status
	end, nil, reset
end

compile_by_type.limit = function(node, layout)
	local evaluate<const>, operand<const>, reset_child<const> = compile_node(node.child, layout)
	local limit<const> = node.limit
	local state_slot<const> = allocate_state_slot(layout)
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local count<const> = execution_state[state_slot] or 0
		if count < limit then
			local status<const> = evaluate(target, execution, operand)
			if status ~= result_running then
				execution_state[state_slot] = count + 1
			end
			return status
		end
		return result_failure
	end, nil, reset_child
end

compile_by_type.wait = function(node, layout)
	local duration_ticks<const> = node.duration_ticks
	local state_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(_target, _execution, execution_state)
		execution_state[state_slot] = nil
	end
	return function(_target, execution)
		local execution_state<const> = execution._execution_state
		local elapsed<const> = execution_state[state_slot] or 0
		if elapsed < duration_ticks then
			execution_state[state_slot] = elapsed + 1
			return result_running
		end
		execution_state[state_slot] = nil
		return result_success
	end, nil, reset
end

compile_by_type.task = task_program.compile
compile_by_type.timeline = task_program.compile_timeline

compile_by_type.set_blackboard = blackboard_program.compile_set
compile_by_type.add_blackboard = blackboard_program.compile_add

compile_node = function(node, layout)
	local evaluate, operand, reset = compile_by_type[node.type](node, layout)
	local services<const> = node.services
	if services ~= nil then
		evaluate, operand, reset = service_program.compile(services, layout, evaluate, operand, reset)
	end
	local decorators<const> = node.decorators
	if decorators ~= nil then
		evaluate, operand, reset = blackboard_program.compile_decorators(decorators, layout, evaluate, operand, reset)
	end
	return evaluate, operand, reset
end

-- Authored definitions are admission input. The retained program contains
-- only the evaluator graph, immutable operands, its reset path and a factory
-- for component-owned evaluator slots and node-memory records.
function program.compile(tree_id, definition)
	local blackboard_definition<const> = definition.blackboard
	local blackboard_layout
	if blackboard_definition ~= nil then
		blackboard_layout = blackboard.compile(blackboard_definition)
	end
	local layout<const> = execution_layout.new(blackboard_layout)
	local evaluate<const>, operand<const>, reset<const> = compile_node(definition.root, layout)
	return {
		id = tree_id,
		blackboard_layout = blackboard_layout,
		evaluate = evaluate,
		operand = operand,
		reset = reset,
		create_execution_state = execution_layout.compile_state_factory(layout),
	}
end

return program
