local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local blackboard_program<const> = require('cartlib/behaviour_tree/blackboard_program')
local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Blackboard decorators are admission-time branch programs. A condition is
-- tested when its branch is entered, then observed by dense Blackboard slot.
-- Notifications only accumulate execution requests; subtree mutation happens
-- at the next behaviour-tree update boundary. This mirrors UE's separation
-- between Blackboard observation and BehaviorTreeComponent flow processing
-- without a per-frame observer scan or dynamic listener registration.
-- Result-change requests are resolved against the final Blackboard state at
-- that boundary; value-change requests retain their authored restart intent.
-- `observer_aborts` accepts `none`, `self`, `lower_priority` or `both`;
-- `notify_observer` accepts `result_change` (the default) or `value_change`.

local observer_program<const> = {}
local resolved_slot_index<const> = blackboard.resolved_slot_index
local result_success<const> = result.success
local result_failure<const> = result.failure
local allocate_slot<const> = execution_layout.allocate_slot
local allocate_flag<const> = execution_layout.allocate_flag
local self_result_request<const> = 1
local self_value_request<const> = 2

local abort_modes<const> = {
	none = { false, false },
	self = { true, false },
	lower_priority = { false, true },
	both = { true, true },
}

local notify_modes<const> = {
	value_change = 1,
	result_change = 2,
}

local execution_request_order<const> = function(left, right)
	return left.execution_index < right.execution_index
end

local register_blackboard_observer<const> = function(layout, slot, notify)
	local observers_by_slot<const> = layout.blackboard_observers_by_slot
	local observers = observers_by_slot[slot]
	if observers == nil then
		observers = {}
		observers_by_slot[slot] = observers
	end
	observers[#observers + 1] = notify
end

function observer_program.register_execution_request(layout, execution_index, capture, process)
	local requests<const> = layout.execution_requests
	requests[#requests + 1] = {
		execution_index = execution_index,
		capture = capture,
		process = process,
	}
end

function observer_program.bind_lower_priority(branch, request_slot, child_index)
	branch.queue_lower_priority = function(execution)
		local execution_state<const> = execution._execution_state
		local requested_child<const> = execution_state[request_slot]
		if not requested_child or child_index < requested_child then
			execution_state[request_slot] = child_index
		end
		execution:request_execution()
	end
end

local compile_condition<const> = function(definitions, layout)
	local count<const> = #definitions
	if count == 1 then
		return blackboard_program.compile_test(definitions[1], layout)
	end
	local tests<const> = {}
	for index = 1, count do
		tests[index] = blackboard_program.compile_test(definitions[index], layout)
	end
	return function(values)
		for index = 1, count do
			if not tests[index](values) then
				return false
			end
		end
		return true
	end
end

function observer_program.compile_decorators(
	definitions,
	layout,
	execution_index,
	evaluate_child,
	operand,
	reset_child
)
	local condition<const> = compile_condition(definitions, layout)
	local observed_by_slot<const> = {}
	local observes_self = false
	local observes_lower_priority = false
	for index = 1, #definitions do
		local definition<const> = definitions[index]
		local abort_mode_name = definition.observer_aborts
		if abort_mode_name == nil then
			abort_mode_name = 'none'
		end
		local abort_mode<const> = abort_modes[abort_mode_name]
		local observes_self_for_definition<const> = abort_mode[1]
		local observes_lower_for_definition<const> = abort_mode[2]
		if observes_self_for_definition or observes_lower_for_definition then
			local notify_mode_name = definition.notify_observer
			if notify_mode_name == nil then
				notify_mode_name = 'result_change'
			end
			local notify_mode<const> = notify_modes[notify_mode_name]
			local slot<const> = definition.key[resolved_slot_index]
			local observed = observed_by_slot[slot]
			if observed == nil then
				observed = { false, false, false }
				observed_by_slot[slot] = observed
			end
			if observes_self_for_definition then
				observed[notify_mode] = true
				observes_self = true
			end
			if observes_lower_for_definition then
				observed[3] = true
				observes_lower_priority = true
			end
		end
	end

	local active_slot<const> = allocate_flag(layout)
	local lower_priority_slot
	local branch
	if observes_lower_priority then
		lower_priority_slot = allocate_flag(layout)
		branch = {
			lower_priority_slot = lower_priority_slot,
			condition = condition,
			queue_lower_priority = nil,
		}
	end
	local self_request_slot
	local self_processing_slot
	if observes_self then
		self_request_slot = allocate_slot(layout)
		self_processing_slot = allocate_slot(layout)
	end

	local reset
	if reset_child == nil then
		local reset_without_child<const> = function(_target, _execution, execution_state)
			execution_state[active_slot] = false
			if lower_priority_slot ~= nil then
				execution_state[lower_priority_slot] = false
			end
			if self_request_slot ~= nil then
				execution_state[self_request_slot] = false
				execution_state[self_processing_slot] = false
			end
		end
		reset = reset_without_child
	else
		local reset_with_child<const> = function(target, execution, execution_state)
			local was_active<const> = execution_state[active_slot]
			execution_state[active_slot] = false
			if lower_priority_slot ~= nil then
				execution_state[lower_priority_slot] = false
			end
			if self_request_slot ~= nil then
				execution_state[self_request_slot] = false
				execution_state[self_processing_slot] = false
			end
			if was_active then
				reset_child(target, execution, execution_state)
			end
		end
		reset = reset_with_child
	end

	if self_request_slot ~= nil then
		observer_program.register_execution_request(layout, execution_index, function(execution_state)
			execution_state[self_processing_slot] = execution_state[self_request_slot]
			execution_state[self_request_slot] = false
		end, function(target, execution, execution_state)
			local request<const> = execution_state[self_processing_slot]
			execution_state[self_processing_slot] = false
			if request == self_value_request
			or (request == self_result_request and not condition(execution.blackboard._values)) then
				reset(target, execution, execution_state)
			end
		end)
	end

	local blackboard_layout<const> = layout.blackboard_layout
	for slot = 1, #blackboard_layout.keys do
		local observed<const> = observed_by_slot[slot]
		if observed ~= nil then
			local observes_self_value<const> = observed[1]
			local observes_self_result<const> = observed[2]
			local observes_lower<const> = observed[3]
			register_blackboard_observer(layout, slot, function(execution, values)
				local execution_state<const> = execution._execution_state
				if execution_state[active_slot] then
					if observes_self_value then
						execution_state[self_request_slot] = self_value_request
						execution:request_execution()
					elseif observes_self_result
					and execution_state[self_request_slot] ~= self_value_request then
						if condition(values) then
							execution_state[self_request_slot] = false
						else
							execution_state[self_request_slot] = self_result_request
							execution:request_execution()
						end
					end
				elseif observes_lower and execution_state[lower_priority_slot] then
					if condition(values) then
						branch.queue_lower_priority(execution)
					end
				end
			end)
		end
	end

	return function(target, execution)
		local execution_state<const> = execution._execution_state
		if not execution_state[active_slot] then
			if not condition(execution.blackboard._values) then
				return result_failure
			end
			execution_state[active_slot] = true
			if lower_priority_slot ~= nil then
				execution_state[lower_priority_slot] = false
			end
		end
		local status<const> = evaluate_child(target, execution, operand)
		if status >= result_success then
			execution_state[active_slot] = false
			if self_request_slot ~= nil then
				execution_state[self_request_slot] = false
				execution_state[self_processing_slot] = false
			end
		end
		return status
	end, nil, reset, branch
end

local compile_notification<const> = function(observers)
	local count<const> = #observers
	if count == 1 then
		return observers[1]
	end
	return function(execution, values)
		for index = 1, count do
			observers[index](execution, values)
		end
	end
end

function observer_program.compile_runtime(layout)
	local notifications
	local blackboard_layout<const> = layout.blackboard_layout
	if blackboard_layout ~= nil then
		local observers_by_slot<const> = layout.blackboard_observers_by_slot
		for slot = 1, #blackboard_layout.keys do
			local observers<const> = observers_by_slot[slot]
			if observers ~= nil then
				if notifications == nil then
					notifications = {}
				end
				notifications[slot] = compile_notification(observers)
			end
		end
	end

	local requests<const> = layout.execution_requests
	local request_count<const> = #requests
	if request_count == 0 then
		return notifications
	end
	if request_count > 1 then
		table.sort(requests, execution_request_order)
	end
	if request_count == 1 then
		local request<const> = requests[1]
		return notifications, function(target, execution, execution_state)
			request.capture(execution_state)
			request.process(target, execution, execution_state)
		end
	end
	return notifications, function(target, execution, execution_state)
		for index = 1, request_count do
			requests[index].capture(execution_state)
		end
		for index = 1, request_count do
			requests[index].process(target, execution, execution_state)
		end
	end
end

return observer_program
