local scratch_record_batch<const> = require('cartlib/util/scratch_record_batch')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')

local timeline_dispatch<const> = {}

local acquire_payload<const> = function(state, payloads)
	local depth<const> = state.depth + 1
	state.depth = depth
	local payload<const> = payloads:get(depth)
	payload.timeline_id = state.timeline_id
	return payload
end

local dispatch_evaluation<const> = function(entry, owner, evaluation)
	local state<const> = entry.timeline_dispatch_state
	local payload
	if evaluation.sample then
		payload = acquire_payload(state, state.frame_payloads)
		payload.previous_frame = evaluation.previous_frame
		payload.frame_index = evaluation.frame
		payload.frame_value = evaluation.value
		payload.previous_time_ms = evaluation.previous_time_ms
		payload.time_ms = evaluation.time_ms
		payload.method = evaluation.method
		payload.direction = evaluation.direction
		payload.wrapped = evaluation.wrapped
		payload.initial = evaluation.initial
	end
	-- The admitted program preserves the phase order: persistent state,
	-- sampled values, nested sequences, then one-shot events.
	entry.instance.program.evaluate(entry, owner, evaluation, payload)
	if evaluation.sample then
		owner.events:emit(state.scoped_frame_event_type, payload)
		state.depth = state.depth - 1
	end
end

local dispatch_end<const> = function(entry, owner, evaluation)
	local state<const> = entry.timeline_dispatch_state
	local payload<const> = acquire_payload(state, state.end_payloads)
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
		local frame_payloads<const> = scratch_record_batch.new(1)
		local frame_payload<const> = frame_payloads.items[1]
		frame_payload.timeline_id = timeline_id
		frame_payload.previous_frame = -1
		frame_payload.frame_index = 0
		frame_payload.frame_value = false
		frame_payload.previous_time_ms = 0
		frame_payload.time_ms = 0
		frame_payload.method = 0
		frame_payload.direction = 0
		frame_payload.wrapped = false
		frame_payload.initial = false
		local end_payloads<const> = scratch_record_batch.new(1)
		local end_payload<const> = end_payloads.items[1]
		end_payload.timeline_id = timeline_id
		end_payload.frame_index = 0
		end_payload.mode = false
		end_payload.wrapped = false
		end_payload.time_ms = 0
		state = {
			frame_payloads = frame_payloads,
			end_payloads = end_payloads,
			depth = 0,
			timeline_id = timeline_id,
			scoped_frame_event_type = 'timeline.frame.' .. timeline_id,
			scoped_end_event_type = 'timeline.end.' .. timeline_id,
		}
		entry.timeline_dispatch_state = state
	else
		state.timeline_id = timeline_id
		state.scoped_frame_event_type = 'timeline.frame.' .. timeline_id
		state.scoped_end_event_type = 'timeline.end.' .. timeline_id
	end
	timeline_track_evaluator.init_entry(entry)
end

function timeline_dispatch.process_instance_evaluations(entry, owner)
	local instance<const> = entry.instance
	for index = 1, instance.evaluation_count do
		local evaluation<const> = instance.evaluations[index]
		dispatch_evaluation(entry, owner, evaluation)
		if evaluation.ended then
			dispatch_end(entry, owner, evaluation)
		end
	end
	return instance.ended
end

return timeline_dispatch
