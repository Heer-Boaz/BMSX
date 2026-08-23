local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local observer_program<const> = require('cartlib/behaviour_tree/observer_program')
local result<const> = require('cartlib/behaviour_tree/result')

-- Decorators are lowered at tree admission. Custom decorator types own their
-- predicate; a tree placement selects the type. Blackboard decorators retain
-- the event-driven observer path. Target predicates are evaluated directly
-- while their branch owns execution, then abort that branch as soon as the
-- predicate stops holding. Loop decorators restart the complete decorated
-- branch, including its admission conditions and Services. Finite loops can
-- complete synchronous iterations in one search; infinite loops admit at most
-- one iteration per behaviour update. Predicate evaluation allocates no node
-- memory and introduces no Blackboard shadow state for values already owned by
-- the target.

local decorator_program<const> = {}
local result_success<const> = result.success
local result_failure<const> = result.failure
local result_running<const> = result.running
local allocate_flag<const> = execution_layout.allocate_flag
local allocate_slot<const> = execution_layout.allocate_slot

local compile_predicate<const> = function(definitions)
	local count<const> = #definitions
	if count == 1 then
		return definitions[1].decorator.evaluate
	end
	local predicates<const> = {}
	for index = 1, count do
		predicates[index] = definitions[index].decorator.evaluate
	end
	return function(target, execution)
		for index = 1, count do
			if not predicates[index](target, execution) then
				return false
			end
		end
		return true
	end
end

local compile_predicate_decorators<const> = function(
	definitions,
	layout,
	evaluate_child,
	operand,
	reset_child,
	branch,
	track_admission,
	child_tracks_admission
)
	local predicate<const> = compile_predicate(definitions)
	if reset_child == nil then
		if track_admission then
			return function(target, execution)
				if predicate(target, execution) then
					if child_tracks_admission then
						return evaluate_child(target, execution, operand)
					end
					return evaluate_child(target, execution, operand), true
				end
				return result_failure, false
			end, nil, nil, branch
		end
		return function(target, execution)
			if predicate(target, execution) then
				return evaluate_child(target, execution, operand)
			end
			return result_failure
		end, nil, nil, branch
	end

	local active_slot<const> = allocate_flag(layout)
	local reset<const> = function(target, execution, execution_state)
		if execution_state[active_slot] then
			execution_state[active_slot] = false
			reset_child(target, execution, execution_state)
		end
	end
	if track_admission then
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			if not predicate(target, execution) then
				if execution_state[active_slot] then
					execution_state[active_slot] = false
					reset_child(target, execution, execution_state)
				end
				return result_failure, false
			end
			local status, admitted
			if child_tracks_admission then
				status, admitted = evaluate_child(target, execution, operand)
			else
				status = evaluate_child(target, execution, operand)
				admitted = true
			end
			execution_state[active_slot] = admitted and status < result_success
			return status, admitted
		end, nil, reset, branch
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		if not predicate(target, execution) then
			if execution_state[active_slot] then
				execution_state[active_slot] = false
				reset_child(target, execution, execution_state)
			end
			return result_failure
		end
		local status<const> = evaluate_child(target, execution, operand)
		execution_state[active_slot] = status < result_success
		return status
	end, nil, reset, branch
end

local compile_condition_decorators<const> = function(
	definitions,
	layout,
	execution_index,
	evaluate_child,
	operand,
	reset_child,
	track_admission
)
	local blackboard_count = 0
	for index = 1, #definitions do
		if definitions[index].type == 'blackboard' then
			blackboard_count = blackboard_count + 1
		end
	end
	if blackboard_count == #definitions then
		return observer_program.compile_blackboard_decorators(
			definitions,
			layout,
			execution_index,
			evaluate_child,
			operand,
			reset_child,
			track_admission
		)
	end
	if blackboard_count == 0 then
		return compile_predicate_decorators(
			definitions,
			layout,
			evaluate_child,
			operand,
			reset_child,
			nil,
			track_admission,
			false
		)
	end

	local blackboard_definitions<const> = {}
	local predicate_definitions<const> = {}
	for index = 1, #definitions do
		local definition<const> = definitions[index]
		if definition.type == 'blackboard' then
			blackboard_definitions[#blackboard_definitions + 1] = definition
		else
			predicate_definitions[#predicate_definitions + 1] = definition
		end
	end
	local branch
	evaluate_child, operand, reset_child, branch = observer_program.compile_blackboard_decorators(
		blackboard_definitions,
		layout,
		execution_index,
		evaluate_child,
		operand,
		reset_child,
		track_admission
	)
	return compile_predicate_decorators(
		predicate_definitions,
		layout,
		evaluate_child,
		operand,
		reset_child,
		branch,
		track_admission,
		track_admission
	)
end

local compile_infinite_loop<const> = function(evaluate_child, operand, reset_child, tracks_admission)
	if tracks_admission then
		return function(target, execution)
			local status<const>, admitted<const> = evaluate_child(target, execution, operand)
			if not admitted or status < result_success then
				return status
			end
			if reset_child ~= nil then
				reset_child(target, execution, execution._execution_state)
			end
			return result_running
		end, nil, reset_child
	end
	return function(target, execution)
		local status<const> = evaluate_child(target, execution, operand)
		if status < result_success then
			return status
		end
		if reset_child ~= nil then
			reset_child(target, execution, execution._execution_state)
		end
		return result_running
	end, nil, reset_child
end

local compile_finite_loop<const> = function(
	definition,
	layout,
	evaluate_child,
	operand,
	reset_child,
	tracks_admission
)
	local completed_slot<const> = allocate_slot(layout)
	local num_loops<const> = definition.num_loops
	local reset<const> = function(target, execution, execution_state)
		execution_state[completed_slot] = nil
		if reset_child ~= nil then
			reset_child(target, execution, execution_state)
		end
	end
	if tracks_admission then
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local completed = execution_state[completed_slot] or 0
			while completed < num_loops do
				local status<const>, admitted<const> = evaluate_child(target, execution, operand)
				if not admitted then
					execution_state[completed_slot] = nil
					return status
				end
				if status < result_success then
					execution_state[completed_slot] = completed
					return status
				end
				completed = completed + 1
				if completed < num_loops then
					execution_state[completed_slot] = completed
					if reset_child ~= nil then
						reset_child(target, execution, execution_state)
					end
				else
					execution_state[completed_slot] = nil
					return status
				end
			end
		end, nil, reset
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local completed = execution_state[completed_slot] or 0
		while completed < num_loops do
			local status<const> = evaluate_child(target, execution, operand)
			if status < result_success then
				execution_state[completed_slot] = completed
				return status
			end
			completed = completed + 1
			if completed < num_loops then
				execution_state[completed_slot] = completed
				if reset_child ~= nil then
					reset_child(target, execution, execution_state)
				end
			else
				execution_state[completed_slot] = nil
				return status
			end
		end
	end, nil, reset
end

local compile_loop_decorator<const> = function(
	definition,
	layout,
	evaluate_child,
	operand,
	reset_child,
	tracks_admission
)
	if definition.infinite_loop then
		return compile_infinite_loop(evaluate_child, operand, reset_child, tracks_admission)
	end
	return compile_finite_loop(
		definition,
		layout,
		evaluate_child,
		operand,
		reset_child,
		tracks_admission
	)
end

function decorator_program.compile(
	definitions,
	layout,
	execution_index,
	evaluate_child,
	operand,
	reset_child
)
	local loop_definition
	local loop_index
	local definition_count<const> = #definitions
	for index = 1, definition_count do
		local definition<const> = definitions[index]
		if definition.type == 'loop' then
			loop_definition = definition
			loop_index = index
		end
	end
	if loop_definition == nil then
		return compile_condition_decorators(
			definitions,
			layout,
			execution_index,
			evaluate_child,
			operand,
			reset_child,
			false
		)
	end
	if definition_count == 1 then
		return compile_loop_decorator(
			loop_definition,
			layout,
			evaluate_child,
			operand,
			reset_child,
			false
		)
	end

	local condition_definitions<const> = {}
	for index = 1, definition_count do
		if index ~= loop_index then
			condition_definitions[#condition_definitions + 1] = definitions[index]
		end
	end
	local branch
	evaluate_child, operand, reset_child, branch = compile_condition_decorators(
		condition_definitions,
		layout,
		execution_index,
		evaluate_child,
		operand,
		reset_child,
		true
	)
	evaluate_child, operand, reset_child = compile_loop_decorator(
		loop_definition,
		layout,
		evaluate_child,
		operand,
		reset_child,
		true
	)
	return evaluate_child, operand, reset_child, branch
end

return decorator_program
