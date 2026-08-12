local scratch_record_batch<const> = require('cartlib/util/scratch_record_batch')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')

local timeline_dispatch<const> = {}

local dispatch_end<const> = function(entry, owner, evaluation)
	local state<const> = entry.timeline_dispatch_state
	local depth<const> = state.depth + 1
	state.depth = depth
	local payload<const> = state.end_payloads:get(depth)
	payload.timeline_id = state.timeline_id
	payload.frame_index = evaluation.frame
	payload.mode = evaluation.playback_mode
	payload.wrapped = evaluation.wrapped
	payload.time_ms = evaluation.time_ms
	owner.events:emit(state.scoped_end_event_type, payload)
	state.depth = state.depth - 1
end

function timeline_dispatch.init_entry(entry)
	local state = entry.timeline_dispatch_state
	local timeline_id<const> = entry.instance.id
	if state == nil then
		local end_payloads<const> = scratch_record_batch.new(1)
		local end_payload<const> = end_payloads.items[1]
		end_payload.timeline_id = timeline_id
		end_payload.frame_index = 0
		end_payload.mode = false
		end_payload.wrapped = false
		end_payload.time_ms = 0
		state = {
			end_payloads = end_payloads,
			depth = 0,
			timeline_id = timeline_id,
			scoped_end_event_type = 'timeline.end.' .. timeline_id,
		}
		entry.timeline_dispatch_state = state
	else
		state.timeline_id = timeline_id
		state.scoped_end_event_type = 'timeline.end.' .. timeline_id
	end
	timeline_track_evaluator.init_entry(entry)
end

function timeline_dispatch.process_instance_evaluations(entry, owner)
	local instance<const> = entry.instance
	for index = 1, instance.evaluation_count do
		local evaluation<const> = instance.evaluations[index]
		-- The admitted program preserves the phase order: persistent state,
		-- sampled values, nested sequences, then one-shot events.
		instance.program.evaluate(entry, owner, evaluation)
		if evaluation.ended then
			dispatch_end(entry, owner, evaluation)
		end
	end
	return instance.ended
end

return timeline_dispatch
