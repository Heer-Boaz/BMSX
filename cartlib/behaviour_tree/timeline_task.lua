local result<const> = require('cartlib/behaviour_tree/result')

-- Timeline playback is a latent behaviour-tree task: completion succeeds the
-- task, while subtree abortion stops the playback it admitted.
local timeline_task<const> = {}

local timeline_finished<const> = function(_owner, task_state)
	task_state.complete = true
end

function timeline_task.on_start(task_state, target, _blackboard, definition)
	task_state.complete = false
	target.timelines:play(
		definition.timeline_id,
		definition.play_options,
		timeline_finished,
		task_state
	)
	return result.running
end

function timeline_task.on_running(task_state)
	if task_state.complete then
		return result.success
	end
	return result.running
end

function timeline_task.on_halted(_task_state, target, _blackboard, definition)
	target.timelines:stop(definition.timeline_id)
end

return timeline_task
