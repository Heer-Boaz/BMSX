local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local blackboard_program<const> = require('cartlib/behaviour_tree/blackboard_program')
local decorator_program<const> = require('cartlib/behaviour_tree/decorator_program')
local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local observer_program<const> = require('cartlib/behaviour_tree/observer_program')
local result<const> = require('cartlib/behaviour_tree/result')
local service_program<const> = require('cartlib/behaviour_tree/service_program')
local task_program<const> = require('cartlib/behaviour_tree/task_program')
local timeline_task<const> = require('cartlib/behaviour_tree/timeline_task')

-- Admission-only lowering. Sequence/selector programs retain their running
-- child; Blackboard observers enqueue branch execution requests instead of
-- rescanning reactive composites every frame. Simple Parallel programs select
-- their finish policy at admission. Tasks requesting node memory receive one
-- component-owned state table; active Services occupy a preallocated
-- component-owned lane and run before queued flow changes. Externally completed
-- tasks suspend only the evaluator; its retained Service lane keeps the
-- component scheduled. The frame path allocates nothing and never interprets
-- definitions or resolves keys.

local program<const> = {}
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

-- A Loop is authored flow control, not an enemy-local counter hidden inside a
-- task. Finite loops may complete several synchronous iterations in one tree
-- update. An infinite loop starts at most one iteration per update, matching
-- the search-id boundary used by UE behaviour trees and guaranteeing that a
-- synchronous child cannot monopolize the game thread.
compile_by_type.loop = function(node, layout)
	local evaluate<const>, operand<const>, reset_child<const> = compile_node(node.child, layout)
	local count<const> = node.count
	if count == nil then
		local reset<const> = function(target, execution, execution_state)
			if reset_child ~= nil then
				reset_child(target, execution, execution_state)
			end
		end
		return function(target, execution)
			local status<const> = evaluate(target, execution, operand)
			if status < result_success then
				return status
			end
			if reset_child ~= nil then
				reset_child(target, execution, execution._execution_state)
			end
			if status == result_failure then
				return result_failure
			end
			return result_running
		end, nil, reset
	end

	local completed_slot<const> = allocate_state_slot(layout)
	local reset<const> = function(target, execution, execution_state)
		execution_state[completed_slot] = nil
		if reset_child ~= nil then
			reset_child(target, execution, execution_state)
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local completed = execution_state[completed_slot] or 0
		while completed < count do
			local status<const> = evaluate(target, execution, operand)
			if status < result_success then
				execution_state[completed_slot] = completed
				return status
			end
			if reset_child ~= nil then
				reset_child(target, execution, execution_state)
			end
			if status == result_failure then
				execution_state[completed_slot] = nil
				return result_failure
			end
			completed = completed + 1
		end
		execution_state[completed_slot] = nil
		return result_success
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
			if status >= result_success then
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
	if duration_ticks == nil then
		local minimum_duration_ticks<const> = node.minimum_duration_ticks
		local maximum_duration_ticks<const> = node.maximum_duration_ticks
		return function(_target, execution)
			local execution_state<const> = execution._execution_state
			local remaining = execution_state[state_slot]
			if remaining == nil then
				remaining = math.random(minimum_duration_ticks, maximum_duration_ticks)
			end
			if remaining > 0 then
				execution_state[state_slot] = remaining - 1
				return result_running
			end
			execution_state[state_slot] = nil
			return result_success
		end, nil, reset
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
compile_by_type.timeline = timeline_task.compile

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

-- Authored definitions are admission input. The retained program contains
-- only the evaluator graph, immutable operands, its reset path and a factory
-- for component-owned evaluator slots and node-memory records.
function program.compile(tree_id, definition)
	local blackboard_definition<const> = definition.blackboard
	local blackboard_layout<const> = blackboard_definition and blackboard.compile(blackboard_definition)
	local layout<const> = execution_layout.new(blackboard_layout)
	local evaluate, operand, reset<const> = compile_node(definition.root, layout)
	local notifications<const>, process_execution_requests<const> = observer_program.compile_runtime(layout)
	local tick_active_services<const> = service_program.compile_runtime(layout)
	if blackboard_layout ~= nil then
		blackboard_layout.notifications = notifications
	end
	-- Select one fused root runner at admission. Service, observer and latent
	-- capabilities never become feature branches on the 50 Hz execution path.
	if layout.event_driven_task_count > 0 then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		if tick_active_services ~= nil and process_execution_requests ~= nil then
			local evaluate_waiting_with_services_and_requests<const> = function(target, execution)
				tick_active_services(target, execution)
				local request_pending<const> = execution._execution_request_pending
				if execution._execution_waiting then
					if not request_pending then
						return result_waiting
					end
					execution._execution_waiting = false
				end
				if request_pending then
					execution._execution_request_pending = false
					process_execution_requests(target, execution, execution._execution_state)
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_services_and_requests
		elseif tick_active_services ~= nil then
			local evaluate_waiting_with_services<const> = function(target, execution)
				tick_active_services(target, execution)
				if execution._execution_waiting then
					return result_waiting
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_services
		elseif process_execution_requests ~= nil then
			local evaluate_waiting_with_requests<const> = function(target, execution)
				local request_pending<const> = execution._execution_request_pending
				if execution._execution_waiting then
					if not request_pending then
						return result_waiting
					end
					execution._execution_waiting = false
				end
				if request_pending then
					execution._execution_request_pending = false
					process_execution_requests(target, execution, execution._execution_state)
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_requests
		else
			local evaluate_waiting<const> = function(target, execution)
				if execution._execution_waiting then
					return result_waiting
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting
		end
		operand = nil
	elseif tick_active_services ~= nil and process_execution_requests ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_services_and_requests<const> = function(target, execution)
			tick_active_services(target, execution)
			if execution._execution_request_pending then
				execution._execution_request_pending = false
				process_execution_requests(target, execution, execution._execution_state)
			end
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_services_and_requests
		operand = nil
	elseif tick_active_services ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_services<const> = function(target, execution)
			tick_active_services(target, execution)
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_services
		operand = nil
	elseif process_execution_requests ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_requests<const> = function(target, execution)
			if execution._execution_request_pending then
				execution._execution_request_pending = false
				process_execution_requests(target, execution, execution._execution_state)
			end
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_requests
		operand = nil
	end
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
