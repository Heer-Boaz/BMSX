local blackboard_program<const> = require('cartlib/behaviour_tree/blackboard_program')
local decorator_program<const> = require('cartlib/behaviour_tree/decorator_program')
local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local observer_program<const> = require('cartlib/behaviour_tree/observer_program')
local result<const> = require('cartlib/behaviour_tree/result')
local service_program<const> = require('cartlib/behaviour_tree/service_program')
local task_program<const> = require('cartlib/behaviour_tree/task_program')
local timeline_task<const> = require('cartlib/behaviour_tree/timeline_task')
local wait_task<const> = require('cartlib/behaviour_tree/wait_task')

-- Authored nodes are lowered once into a retained evaluator graph. Composite
-- cursors, decorators, Tasks and Services allocate dense component-owned
-- execution slots while the definition is admitted. Sequence and Selector
-- retain only their active child; Simple Parallel and randomized composites
-- select their execution policy before the frame path. The resulting
-- evaluator allocates nothing and never interprets authored nodes.

local node_program<const> = {}
local result_waiting<const> = result.waiting
local result_running<const> = result.running
local result_success<const> = result.success
local result_failure<const> = result.failure
local compile_by_type<const> = {}
local compile_node

local allocate_state_slot<const> = execution_layout.allocate_slot
local allocate_flag<const> = execution_layout.allocate_flag

local return_success<const> = function()
	return result_success
end

local return_failure<const> = function()
	return result_failure
end

local compile_children<const> = function(children, layout)
	local child_count<const> = #children
	local evaluators<const> = {}
	local operands<const> = {}
	local resetters<const> = {}
	local branches<const> = {}
	for index = 1, child_count do
		local evaluate<const>, operand<const>, reset<const>, branch<const> = compile_node(children[index], layout)
		evaluators[index] = evaluate
		operands[index] = operand
		resetters[index] = reset or false
		branches[index] = branch or false
	end
	return evaluators, operands, resetters, child_count, branches
end

compile_by_type.sequence = function(node, layout)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const> =
		compile_children(node.children, layout)
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
				if status < result_success then
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

compile_by_type.selector = function(node, layout, execution_index)
	local evaluators<const>, operands<const>, resetters<const>, child_count<const>, branches<const> =
		compile_children(node.children, layout)
	if child_count == 0 then
		return return_failure
	end
	if child_count == 1 then
		return evaluators[1], operands[1], resetters[1]
	end
	local state_slot<const> = allocate_state_slot(layout)
	local observes_lower_priority = false
	for child_index = 1, child_count do
		if branches[child_index] then
			observes_lower_priority = true
			break
		end
	end
	if observes_lower_priority then
		local request_slot<const> = allocate_flag(layout)
		local processing_slot<const> = allocate_flag(layout)
		local lower_priority_slots<const> = {}
		for child_index = 1, child_count do
			local branch<const> = branches[child_index]
			if branch then
				lower_priority_slots[child_index] = branch.lower_priority_slot
				observer_program.bind_lower_priority(branch, request_slot, child_index)
			else
				lower_priority_slots[child_index] = false
			end
		end
		local clear_lower_priority<const> = function(execution_state, first_child)
			for child_index = first_child, child_count do
				local lower_priority_slot<const> = lower_priority_slots[child_index]
				if lower_priority_slot then
					execution_state[lower_priority_slot] = false
				end
			end
		end
		local reset<const> = function(target, execution, execution_state)
			local child_index<const> = execution_state[state_slot]
			execution_state[state_slot] = nil
			execution_state[request_slot] = false
			execution_state[processing_slot] = false
			if child_index ~= nil then
				local reset_child<const> = resetters[child_index]
				if reset_child then
					reset_child(target, execution, execution_state)
				end
			end
			clear_lower_priority(execution_state, 1)
		end
		observer_program.register_execution_request(layout, execution_index, function(execution_state)
			execution_state[processing_slot] = execution_state[request_slot]
			execution_state[request_slot] = false
		end, function(
			target,
			execution,
			execution_state
		)
			local requested_child<const> = execution_state[processing_slot]
			execution_state[processing_slot] = false
			if requested_child then
				local active_child<const> = execution_state[state_slot]
				local selected_child
				for child_index = requested_child, active_child - 1 do
					local branch<const> = branches[child_index]
					if branch
					and execution_state[branch.lower_priority_slot]
					and branch.condition(execution.blackboard._values) then
						selected_child = child_index
						break
					end
				end
				if selected_child ~= nil then
					local reset_child<const> = resetters[active_child]
					if reset_child then
						reset_child(target, execution, execution_state)
					end
					clear_lower_priority(execution_state, selected_child)
					execution_state[state_slot] = selected_child
				end
			end
		end)
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local child_index = execution_state[state_slot] or 1
			while child_index <= child_count do
				local lower_priority_slot<const> = lower_priority_slots[child_index]
				if lower_priority_slot then
					execution_state[lower_priority_slot] = false
				end
				local status<const> = evaluators[child_index](target, execution, operands[child_index])
				if status ~= result_failure then
					if status < result_success then
						execution_state[state_slot] = child_index
					else
						execution_state[state_slot] = nil
						execution_state[request_slot] = false
						clear_lower_priority(execution_state, 1)
					end
					return status
				end
				if lower_priority_slot then
					execution_state[lower_priority_slot] = true
				end
				child_index = child_index + 1
			end
			execution_state[state_slot] = nil
			execution_state[request_slot] = false
			clear_lower_priority(execution_state, 1)
			return result_failure
		end, nil, reset
	end
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
				if status < result_success then
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

local compile_simple_parallel_reset<const> = function(reset_main, reset_background, main_status_slot)
	return function(target, execution, execution_state)
		if main_status_slot ~= nil then
			execution_state[main_status_slot] = nil
		end
		if reset_main ~= nil then
			reset_main(target, execution, execution_state)
		end
		if reset_background ~= nil then
			reset_background(target, execution, execution_state)
		end
	end
end

local compile_simple_parallel_abort_background<const> = function(
	_layout,
	evaluate_main,
	main_operand,
	reset_main,
	evaluate_background,
	background_operand,
	reset_background,
	has_event_driven_task
)
	local reset<const> = compile_simple_parallel_reset(reset_main, reset_background)
	if not has_event_driven_task then
		return function(target, execution)
			local main_status<const> = evaluate_main(target, execution, main_operand)
			if main_status ~= result_running then
				reset(target, execution, execution._execution_state)
				return main_status
			end
			local background_status<const> = evaluate_background(target, execution, background_operand)
			if background_status ~= result_running and reset_background ~= nil then
				reset_background(target, execution, execution._execution_state)
			end
			return result_running
		end, nil, reset
	end
	return function(target, execution)
		local main_status<const> = evaluate_main(target, execution, main_operand)
		if main_status >= result_success then
			reset(target, execution, execution._execution_state)
			return main_status
		end
		local background_status<const> = evaluate_background(target, execution, background_operand)
		if background_status >= result_success then
			if reset_background ~= nil then
				reset_background(target, execution, execution._execution_state)
			end
			return result_running
		end
		if main_status == result_running or background_status == result_running then
			return result_running
		end
		return result_waiting
	end, nil, reset
end

local compile_simple_parallel_wait_for_background<const> = function(
	layout,
	evaluate_main,
	main_operand,
	reset_main,
	evaluate_background,
	background_operand,
	reset_background,
	has_event_driven_task
)
	-- An already-running main Task leaves an admitted background tree to finish
	-- regardless of its eventual result. A main Task that fails on its first
	-- search never admits the background; UE only forces that first background
	-- search for immediate success.
	local main_status_slot<const> = allocate_state_slot(layout)
	local reset<const> = compile_simple_parallel_reset(reset_main, reset_background, main_status_slot)
	if not has_event_driven_task then
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local previous_main_status<const> = execution_state[main_status_slot]
			local main_status = previous_main_status
			if main_status == nil or main_status == result_running then
				main_status = evaluate_main(target, execution, main_operand)
				if previous_main_status == nil and main_status == result_failure then
					reset(target, execution, execution_state)
					return result_failure
				end
				if main_status == result_running then
					if previous_main_status == nil then
						execution_state[main_status_slot] = result_running
					end
				else
					execution_state[main_status_slot] = main_status
				end
			end
			local background_status<const> = evaluate_background(target, execution, background_operand)
			if background_status ~= result_running then
				if main_status >= result_success then
					reset(target, execution, execution_state)
					return main_status
				end
				if reset_background ~= nil then
					reset_background(target, execution, execution_state)
				end
			end
			return result_running
		end, nil, reset
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local previous_main_status<const> = execution_state[main_status_slot]
		local main_status = previous_main_status
		if main_status == nil or main_status == result_running then
			main_status = evaluate_main(target, execution, main_operand)
			if previous_main_status == nil and main_status == result_failure then
				reset(target, execution, execution_state)
				return result_failure
			end
			if main_status < result_success then
				if previous_main_status == nil then
					execution_state[main_status_slot] = result_running
				end
			else
				execution_state[main_status_slot] = main_status
			end
		end
		local background_status<const> = evaluate_background(target, execution, background_operand)
		if main_status >= result_success then
			if background_status >= result_success then
				reset(target, execution, execution_state)
				return main_status
			end
			return background_status
		end
		if background_status >= result_success then
			if reset_background ~= nil then
				reset_background(target, execution, execution_state)
			end
			return result_running
		end
		if main_status == result_running or background_status == result_running then
			return result_running
		end
		return result_waiting
	end, nil, reset
end

local compile_simple_parallel_by_finish_mode<const> = {
	abort_background = compile_simple_parallel_abort_background,
	wait_for_background = compile_simple_parallel_wait_for_background,
}

-- UE Simple Parallel admits one main Task and one background subtree. The main
-- Task is evaluated first; a completed background subtree is restarted on the
-- following tree update while the main Task remains active. Finish mode is
-- resolved here so the 50 Hz evaluator contains neither a mode branch nor a
-- child loop/state array.
compile_by_type.simple_parallel = function(node, layout)
	local event_driven_task_count<const> = layout.event_driven_task_count
	local evaluate_main<const>, main_operand<const>, reset_main<const> = compile_node(node.main_task, layout)
	local evaluate_background<const>, background_operand<const>, reset_background<const> =
		compile_node(node.background_tree, layout)
	return compile_simple_parallel_by_finish_mode[node.finish_mode](
		layout,
		evaluate_main,
		main_operand,
		reset_main,
		evaluate_background,
		background_operand,
		reset_background,
		layout.event_driven_task_count ~= event_driven_task_count
	)
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
		if status >= result_success then
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
		if status >= result_success then
			execution_state[state_slot] = nil
		end
		return status
	end, nil, reset
end

compile_by_type.task = task_program.compile
compile_by_type.timeline = timeline_task.compile
compile_by_type.wait = wait_task.compile

compile_by_type.set_blackboard = blackboard_program.compile_set
compile_by_type.add_blackboard = blackboard_program.compile_add

compile_node = function(node, layout)
	local execution_index<const> = execution_layout.allocate_execution_index(layout)
	local evaluate, operand, reset = compile_by_type[node.type](node, layout, execution_index)
	local services<const> = node.services
	if services ~= nil then
		evaluate, operand, reset = service_program.compile(services, layout, evaluate, operand, reset)
	end
	local branch
	local decorators<const> = node.decorators
	if decorators ~= nil then
		evaluate, operand, reset, branch = decorator_program.compile(
			decorators,
			layout,
			execution_index,
			evaluate,
			operand,
			reset
		)
	end
	return evaluate, operand, reset, branch
end

function node_program.compile(root, layout)
	return compile_node(root, layout)
end

return node_program
