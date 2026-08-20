local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local result<const> = require('cartlib/behaviour_tree/result')

-- Timeline playback is an externally completed latent task. Its terminal
-- callback publishes the result into component-owned execution storage and
-- schedules tree execution; the behaviour-tree system does not poll playback.
local timeline_task<const> = {}
local result_waiting<const> = result.waiting
local result_success<const> = result.success
local allocate_slot<const> = execution_layout.allocate_slot

function timeline_task.compile(definition, layout)
	layout.event_driven_task_count = layout.event_driven_task_count + 1
	local status_slot<const> = allocate_slot(layout)
	local timeline_id<const> = definition.timeline_id
	local play_options<const> = definition.play_options
	local finished<const> = function(_owner, execution)
		execution:finish_latent_task(status_slot, result_success)
	end
	local reset<const> = function(target, _execution, execution_state)
		if execution_state[status_slot] ~= nil then
			execution_state[status_slot] = nil
			target.timelines:stop(timeline_id)
		end
	end
	return function(target, execution)
		local execution_state<const> = execution._execution_state
		local status<const> = execution_state[status_slot]
		if status == nil then
			execution_state[status_slot] = result_waiting
			target.timelines:play(timeline_id, play_options, finished, execution)
			return result_waiting
		end
		if status == result_waiting then
			return result_waiting
		end
		execution_state[status_slot] = nil
		return status
	end, nil, reset
end

return timeline_task
