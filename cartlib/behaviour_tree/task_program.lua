local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')
local timeline_task<const> = require('cartlib/behaviour_tree/timeline_task')

-- Tasks are immutable program records. Only tasks that declare node_memory
-- allocate a per-agent table; stateless ticking tasks remain a direct evaluator
-- call. Latent tasks retain one activity slot so branch abortion can distinguish
-- an executing task from an already completed task.
--
-- Stateless callbacks receive (target, execution, parameters). A task with
-- node_memory receives (target, node_memory, execution, parameters).

local task_program<const> = {}
local result_running<const> = result.running
local allocate_slot<const> = execution_layout.allocate_slot
local allocate_node_memory<const> = execution_layout.allocate_node_memory

local compile_ticking_task<const> = function(layout, tick, abort, parameters, uses_node_memory)
	if not uses_node_memory and abort == nil then
		return tick, parameters
	end
	local memory_slot
	local evaluate
	if uses_node_memory then
		memory_slot = allocate_node_memory(layout)
		local evaluate_with_memory<const> = function(target, execution)
			return tick(target, execution._execution_state[memory_slot], execution, parameters)
		end
		evaluate = evaluate_with_memory
	else
		local evaluate_without_memory<const> = function(target, execution)
			return tick(target, execution, parameters)
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
				abort(target, execution_state[memory_slot], execution, parameters)
			end
		end
		reset = reset_with_memory
	else
		local reset_without_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution, parameters)
			end
		end
		reset = reset_without_memory
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local status<const> = evaluate(target, execution)
		if status == result_running then
			execution_state[active_slot] = true
		else
			execution_state[active_slot] = nil
		end
		return status
	end, nil, reset
end

local compile_latent_task<const> = function(layout, execute, tick, abort, parameters, uses_node_memory)
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
				abort(target, execution_state[memory_slot], execution, parameters)
			end
		end
		reset = reset_with_memory
	else
		local reset_without_memory<const> = function(target, execution, execution_state)
			if execution_state[active_slot] then
				execution_state[active_slot] = nil
				abort(target, execution, parameters)
			end
		end
		reset = reset_without_memory
	end
	if uses_node_memory then
		return function(target, execution)
			local execution_state<const> = execution._execution_state
			local memory<const> = execution_state[memory_slot]
			local status
			if execution_state[active_slot] then
				status = tick(target, memory, execution, parameters)
			else
				status = execute(target, memory, execution, parameters)
			end
			if status == result_running then
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
			status = tick(target, execution, parameters)
		else
			status = execute(target, execution, parameters)
		end
		if status == result_running then
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
		return node.execute, node.parameters
	end
	local execute<const> = node.execute
	if execute == nil then
		return compile_ticking_task(layout, tick, node.abort, node.parameters, node.node_memory)
	end
	return compile_latent_task(layout, execute, tick, node.abort, node.parameters, node.node_memory)
end

function task_program.compile_timeline(node, layout)
	return compile_latent_task(
		layout,
		timeline_task.execute,
		timeline_task.tick,
		timeline_task.abort,
		node,
		true
	)
end

return task_program
