local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Tasks are immutable program records. Only tasks that declare node_memory
-- allocate a per-agent table; stateless ticking tasks remain a direct evaluator
-- call. Latent tasks retain one activity slot so branch abortion can distinguish
-- an executing task from an already completed task. An authored interval is
-- lowered into a dedicated countdown evaluator; skipped updates do not enter
-- the cart callback and do not allocate task memory.
--
-- Stateless callbacks receive (target, execution). A task with node_memory
-- receives (target, node_memory, execution). Authored task identity is carried
-- by the callback itself rather than an untyped runtime parameter operand.

local task_program<const> = {}
local result_running<const> = result.running
local result_success<const> = result.success
local allocate_slot<const> = execution_layout.allocate_slot
local allocate_node_memory<const> = execution_layout.allocate_node_memory

local compile_ticking_task<const> = function(layout, tick, abort, uses_node_memory)
	if not uses_node_memory and abort == nil then
		return tick
	end
	local memory_slot
	local evaluate
	if uses_node_memory then
		memory_slot = allocate_node_memory(layout)
		local evaluate_with_memory<const> = function(target, execution)
			return tick(target, execution._execution_state[memory_slot], execution)
		end
		evaluate = evaluate_with_memory
	else
		local evaluate_without_memory<const> = function(target, execution)
			return tick(target, execution)
		end
		evaluate = evaluate_without_memory
	end
	if abort == nil then
		return evaluate
	end
	local active_slot<const> = allocate_slot(layout)
	local reset
	if uses_node_memory then
		local reset_with_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution_state[memory_slot], execution)
			end
		end
		reset = reset_with_memory
	else
		local reset_without_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution)
			end
		end
		reset = reset_without_memory
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local status<const> = evaluate(target, execution)
		if status < result_success then
			execution_state[active_slot] = true
		else
			execution_state[active_slot] = nil
		end
		return status
	end, nil, reset
end

local compile_latent_task<const> = function(
	layout,
	execute,
	tick,
	abort,
	uses_node_memory,
	interval_ticks
)
	local memory_slot
	if uses_node_memory then
		memory_slot = allocate_node_memory(layout)
	end
	local active_slot<const> = allocate_slot(layout)
	local reset
	if abort == nil then
		local reset_without_abort<const> = function(_target, _execution, execution_state)
			execution_state[active_slot] = nil
		end
		reset = reset_without_abort
	elseif uses_node_memory then
		local reset_with_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution_state[memory_slot], execution)
			end
		end
		reset = reset_with_memory
	else
		local reset_without_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution)
			end
		end
		reset = reset_without_memory
	end
	if interval_ticks ~= nil then
		local remaining_slot<const> = allocate_slot(layout)
		if uses_node_memory then
			return function(target, execution)
				local execution_state<const> = execution._execution_state
				local status
				if execution_state[active_slot] then
					local remaining<const> = execution_state[remaining_slot] - 1
					if remaining > 0 then
						execution_state[remaining_slot] = remaining
						return result_running
					end
					execution_state[remaining_slot] = interval_ticks
					status = tick(target, execution_state[memory_slot], execution)
				else
					status = execute(target, execution_state[memory_slot], execution)
					if status < result_success then
						execution_state[remaining_slot] = interval_ticks
					end
				end
				if status < result_success then
					execution_state[active_slot] = true
				else
					execution_state[active_slot] = nil
				end
				return status
			end, nil, reset
		end
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local status
			if execution_state[active_slot] then
				local remaining<const> = execution_state[remaining_slot] - 1
				if remaining > 0 then
					execution_state[remaining_slot] = remaining
					return result_running
				end
				execution_state[remaining_slot] = interval_ticks
				status = tick(target, execution)
			else
				status = execute(target, execution)
				if status < result_success then
					execution_state[remaining_slot] = interval_ticks
				end
			end
			if status < result_success then
				execution_state[active_slot] = true
			else
				execution_state[active_slot] = nil
			end
			return status
		end, nil, reset
	end
	if uses_node_memory then
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local memory<const> = execution_state[memory_slot]
			local status
			if execution_state[active_slot] then
				status = tick(target, memory, execution)
			else
				status = execute(target, memory, execution)
			end
			if status < result_success then
				execution_state[active_slot] = true
			else
				execution_state[active_slot] = nil
			end
			return status
		end, nil, reset
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local status
		if execution_state[active_slot] then
			status = tick(target, execution)
		else
			status = execute(target, execution)
		end
		if status < result_success then
			execution_state[active_slot] = true
		else
			execution_state[active_slot] = nil
		end
		return status
	end, nil, reset
end

function task_program.compile(node, layout)
	local tick<const> = node.tick
	if tick == nil then
		return node.execute
	end
	local execute<const> = node.execute
	if execute == nil then
		return compile_ticking_task(layout, tick, node.abort, node.node_memory)
	end
	return compile_latent_task(
		layout,
		execute,
		tick,
		node.abort,
		node.node_memory,
		node.interval_ticks
	)
end

return task_program
