local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Services are immutable auxiliary nodes attached to a task or composite. The
-- execution component owns their active bit, interval accumulator and optional
-- node memory. Search start precedes become-relevant; active Services tick
-- before their branch, matching UE's ordering without an active-node list.
-- Stateless callbacks receive (target, execution, ...); callbacks on a Service
-- with node_memory receive (target, node_memory, execution, ...).

local service_program<const> = {}
local result_running<const> = result.running
local allocate_slot<const> = execution_layout.allocate_slot
local allocate_node_memory<const> = execution_layout.allocate_node_memory

local compile_service<const> = function(definition, layout)
	local on_search_start<const> = definition.on_search_start
	local on_become_relevant<const> = definition.on_become_relevant
	local on_tick<const> = definition.on_tick
	local on_cease_relevant<const> = definition.on_cease_relevant
	local parameters<const> = definition.parameters
	local interval_ticks<const> = definition.interval_ticks
	local tick_on_search_start<const> = definition.tick_on_search_start
	local restart_timer_on_each_activation<const> = definition.restart_timer_on_each_activation
	local uses_node_memory<const> = definition.node_memory
	local memory_slot
	if uses_node_memory then
		memory_slot = allocate_node_memory(layout)
	end
	local update
	local remaining_slot
	local elapsed_slot
	if on_tick ~= nil then
		remaining_slot = allocate_slot(layout)
		elapsed_slot = allocate_slot(layout)
		update = function(target, execution)
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
				on_tick(target, execution_state[memory_slot], execution, elapsed, parameters)
			else
				on_tick(target, execution, elapsed, parameters)
			end
		end
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
				on_search_start(target, execution_state[memory_slot], execution, parameters)
			else
				on_search_start(target, execution, parameters)
			end
		end
		if tick_on_search_start then
			if uses_node_memory then
				on_tick(target, execution_state[memory_slot], execution, 0, parameters)
			else
				on_tick(target, execution, 0, parameters)
			end
			execution_state[remaining_slot] = interval_ticks
			execution_state[elapsed_slot] = 0
		end
		if on_become_relevant ~= nil then
			if uses_node_memory then
				on_become_relevant(target, execution_state[memory_slot], execution, parameters)
			else
				on_become_relevant(target, execution, parameters)
			end
		end
	end
	local stop
	if on_cease_relevant ~= nil then
		if uses_node_memory then
			local stop_with_memory<const> = function(target, execution)
				on_cease_relevant(
					target,
					execution._execution_state[memory_slot],
					execution,
					parameters
				)
			end
			stop = stop_with_memory
		else
			local stop_without_memory<const> = function(target, execution)
				on_cease_relevant(target, execution, parameters)
			end
			stop = stop_without_memory
		end
	end
	return start, update, stop
end

function service_program.compile(definitions, layout, evaluate, operand, reset_child)
	local service_count<const> = #definitions
	local starts<const> = {}
	local updates<const> = {}
	local stops<const> = {}
	local update_count = 0
	local stop_count = 0
	for index = 1, service_count do
		local start<const>, update<const>, stop<const> = compile_service(definitions[index], layout)
		starts[index] = start
		if update ~= nil then
			update_count = update_count + 1
			updates[update_count] = update
		end
		if stop ~= nil then
			stop_count = stop_count + 1
			stops[stop_count] = stop
		end
	end
	local active_slot<const> = allocate_slot(layout)
	local start_services
	local update_services
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
	if update_count == 1 then
		update_services = updates[1]
	elseif update_count > 1 then
		update_services = function(target, execution)
			for index = 1, update_count do
				updates[index](target, execution)
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
			execution_state[active_slot] = nil
			if stop_services ~= nil then
				stop_services(target, execution)
			end
		end
		if reset_child ~= nil then
			reset_child(target, execution, execution_state)
		end
	end
	if update_services == nil then
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
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		if not execution_state[active_slot] then
			execution_state[active_slot] = true
			start_services(target, execution)
		end
		update_services(target, execution)
		local status<const> = evaluate(target, execution, operand)
		if status ~= result_running then
			reset(target, execution, execution_state)
		end
		return status
	end, nil, reset
end

return service_program
