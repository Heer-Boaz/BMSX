local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Services are immutable auxiliary nodes attached to a task or composite. The
-- execution component owns their activity, interval accumulator, optional node
-- memory and a preallocated dense lane of active tick callbacks. That lane is
-- advanced before Blackboard execution requests and the tree evaluator. A
-- branch transition changes the retained lane; recursive subtree traversal is
-- not used as a Service scheduler.
-- Stateless callbacks receive (target, execution, elapsed_ticks); callbacks on
-- a Service with node_memory receive
-- (target, node_memory, execution, elapsed_ticks).

local service_program<const> = {}
local result_running<const> = result.running
local allocate_slot<const> = execution_layout.allocate_slot
local allocate_flag<const> = execution_layout.allocate_flag
local allocate_node_memory<const> = execution_layout.allocate_node_memory

local remove_active_service<const> = function(execution, tick)
	local active_services<const> = execution._active_services
	local active_service_count<const> = execution._active_service_count
	local position = 1
	while active_services[position] ~= tick do
		position = position + 1
	end
	for index = position, active_service_count - 1 do
		active_services[index] = active_services[index + 1]
	end
	active_services[active_service_count] = false
	execution._active_service_count = active_service_count - 1
end

local compile_service<const> = function(definition, layout)
	local on_search_start<const> = definition.on_search_start
	local on_become_relevant<const> = definition.on_become_relevant
	local on_tick<const> = definition.on_tick
	local on_cease_relevant<const> = definition.on_cease_relevant
	local interval_ticks<const> = definition.interval_ticks
	local tick_on_search_start<const> = definition.tick_on_search_start
	local restart_timer_on_each_activation<const> = definition.restart_timer_on_each_activation
	local uses_node_memory<const> = definition.node_memory
	local memory_slot
	if uses_node_memory then
		memory_slot = allocate_node_memory(layout)
	end
	local tick
	local remaining_slot
	local elapsed_slot
	if on_tick ~= nil then
		remaining_slot = allocate_slot(layout)
		elapsed_slot = allocate_slot(layout)
		tick = function(target, execution)
			local execution_state<const> = execution._execution_state
			local remaining<const> = execution_state[remaining_slot] - 1
			local elapsed<const> = execution_state[elapsed_slot] + 1
			if remaining > 0 then
				execution_state[remaining_slot] = remaining
				execution_state[elapsed_slot] = elapsed
				return
			end
			-- Carrying the fractional remainder preserves an interval between
			-- two 50 Hz ticks without changing its long-term cadence.
			execution_state[remaining_slot] = remaining + interval_ticks
			execution_state[elapsed_slot] = 0
			if uses_node_memory then
				on_tick(target, execution_state[memory_slot], execution, elapsed)
			else
				on_tick(target, execution, elapsed)
			end
		end
		layout.service_count = layout.service_count + 1
	end
	local start<const> = function(target, execution)
		local execution_state<const> = execution._execution_state
		if on_tick ~= nil then
			local remaining<const> = execution_state[remaining_slot]
			if restart_timer_on_each_activation or remaining == nil or remaining <= 0 then
				execution_state[remaining_slot] = interval_ticks
				execution_state[elapsed_slot] = 0
			end
		end
		if on_search_start ~= nil then
			if uses_node_memory then
				on_search_start(target, execution_state[memory_slot], execution)
			else
				on_search_start(target, execution)
			end
		end
		if tick_on_search_start then
			if uses_node_memory then
				on_tick(target, execution_state[memory_slot], execution, 0)
			else
				on_tick(target, execution, 0)
			end
			execution_state[remaining_slot] = interval_ticks
			execution_state[elapsed_slot] = 0
		end
		if on_become_relevant ~= nil then
			if uses_node_memory then
				on_become_relevant(target, execution_state[memory_slot], execution)
			else
				on_become_relevant(target, execution)
			end
		end
		if tick ~= nil then
			local active_service_count<const> = execution._active_service_count + 1
			execution._active_service_count = active_service_count
			execution._active_services[active_service_count] = tick
			-- A newly admitted Service consumes the current tree tick once,
			-- just like an auxiliary node added by a completed UE search.
			tick(target, execution)
		end
	end
	local stop
	if tick == nil then
		if on_cease_relevant == nil then
			return start
		end
		if uses_node_memory then
			local stop_with_memory<const> = function(target, execution)
				on_cease_relevant(
					target,
					execution._execution_state[memory_slot],
					execution
				)
			end
			stop = stop_with_memory
		else
			local stop_without_memory<const> = function(target, execution)
				on_cease_relevant(target, execution)
			end
			stop = stop_without_memory
		end
		return start, stop
	end
	if on_cease_relevant == nil then
		local stop_without_callback<const> = function(_target, execution)
			remove_active_service(execution, tick)
		end
		stop = stop_without_callback
	elseif uses_node_memory then
		local stop_with_memory<const> = function(target, execution)
			remove_active_service(execution, tick)
			on_cease_relevant(
				target,
				execution._execution_state[memory_slot],
				execution
			)
		end
		stop = stop_with_memory
	else
		local stop_without_memory<const> = function(target, execution)
			remove_active_service(execution, tick)
			on_cease_relevant(target, execution)
		end
		stop = stop_without_memory
	end
	return start, stop
end

function service_program.compile(definitions, layout, evaluate, operand, reset_child)
	local service_count<const> = #definitions
	local starts<const> = {}
	local stops<const> = {}
	local stop_count = 0
	for index = 1, service_count do
		local start<const>, stop<const> = compile_service(definitions[index], layout)
		starts[index] = start
		if stop ~= nil then
			stop_count = stop_count + 1
			stops[stop_count] = stop
		end
	end
	local active_slot<const> = allocate_flag(layout)
	local start_services
	local stop_services
	if service_count == 1 then
		start_services = starts[1]
	else
		start_services = function(target, execution)
			for index = 1, service_count do
				starts[index](target, execution)
			end
		end
	end
	if stop_count == 1 then
		stop_services = stops[1]
	elseif stop_count > 1 then
		stop_services = function(target, execution)
			for index = 1, stop_count do
				stops[index](target, execution)
			end
		end
	end
	local reset<const> = function(target, execution, execution_state)
		if execution_state[active_slot] then
			execution_state[active_slot] = false
			if stop_services ~= nil then
				stop_services(target, execution)
			end
		end
		if reset_child ~= nil then
			reset_child(target, execution, execution_state)
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		if not execution_state[active_slot] then
			execution_state[active_slot] = true
			start_services(target, execution)
		end
		local status<const> = evaluate(target, execution, operand)
		if status ~= result_running then
			reset(target, execution, execution_state)
		end
		return status
	end, nil, reset
end

function service_program.compile_runtime(layout)
	local service_count<const> = layout.service_count
	if service_count == 0 then
		return nil
	end
	return function(target, execution)
		local active_services<const> = execution._active_services
		local active_service_count<const> = execution._active_service_count
		for index = 1, active_service_count do
			active_services[index](target, execution)
		end
	end
end

return service_program
