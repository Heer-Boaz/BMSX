local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Wait is a built-in Task type. Its authored duration is lowered to one
-- component-owned counter; a random duration is selected once when the Task is
-- admitted and retained until completion. Neither path reads the definition or
-- allocates on the frame path.

local wait_task<const> = {}
local result_running<const> = result.running
local result_success<const> = result.success
local allocate_slot<const> = execution_layout.allocate_slot

function wait_task.compile(node, layout)
	local duration_ticks<const> = node.duration_ticks
	local state_slot<const> = allocate_slot(layout)
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

return wait_task
