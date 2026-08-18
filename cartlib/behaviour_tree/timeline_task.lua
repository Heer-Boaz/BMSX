local result<const> = require('cartlib/behaviour_tree/result')

-- Timeline playback is a latent behaviour-tree task: completion succeeds the
-- task, while subtree abortion stops the playback it admitted.
local timeline_task<const> = {}

local timeline_finished<const> = function(_owner, node_memory)
	node_memory.complete = true
end

function timeline_task.execute(target, node_memory, _execution, definition)
	node_memory.complete = false
	target.timelines:play(
		definition.timeline_id,
		definition.play_options,
		timeline_finished,
		node_memory
	)
	return result.running
end

function timeline_task.tick(_target, node_memory)
	if node_memory.complete then
		return result.success
	end
	return result.running
end

function timeline_task.abort(target, _node_memory, _execution, definition)
	target.timelines:stop(definition.timeline_id)
end

return timeline_task
