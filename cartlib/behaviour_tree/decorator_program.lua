local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local observer_program<const> = require('cartlib/behaviour_tree/observer_program')
local result<const> = require('cartlib/behaviour_tree/result')

-- Decorators are lowered at tree admission. Custom decorator types own their
-- predicate; a tree placement selects the type. Blackboard decorators retain
-- the event-driven observer path. Target predicates are evaluated directly
-- while their branch owns execution, then abort that branch as soon as the
-- predicate stops holding. Predicate evaluation allocates no node memory and
-- introduces no Blackboard shadow state for values already owned by the
-- target.

local decorator_program<const> = {}
local result_success<const> = result.success
local result_failure<const> = result.failure
local allocate_flag<const> = execution_layout.allocate_flag

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
	branch
)
	local predicate<const> = compile_predicate(definitions)
	if reset_child == nil then
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

function decorator_program.compile(
	definitions,
	layout,
	execution_index,
	evaluate_child,
	operand,
	reset_child
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
			reset_child
		)
	end
	if blackboard_count == 0 then
		return compile_predicate_decorators(
			definitions,
			layout,
			evaluate_child,
			operand,
			reset_child
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
		reset_child
	)
	return compile_predicate_decorators(
		predicate_definitions,
		layout,
		evaluate_child,
		operand,
		reset_child,
		branch
	)
end

return decorator_program
