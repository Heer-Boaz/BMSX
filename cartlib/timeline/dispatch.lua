local scratch_record_batch<const> = require('cartlib/util/scratch_record_batch')

local timelinedispatch<const> = {}

local acquire_payload<const> = function(state, payloads)
	local depth<const> = state.depth + 1
	state.depth = depth
	local payload<const> = payloads:get(depth)
	payload.timelineid = state.timelineid
	return payload
end

local apply_markers<const> = function(entry, owner, frame_index)
	local bucket<const> = entry.markers.by_frame[frame_index + 1]
	if bucket == nil then
		return
	end
	for i = 1, #bucket do
		local marker<const> = bucket[i]
		local add_tags<const> = marker.add_tags
		if add_tags ~= nil then
			for j = 1, #add_tags do
				owner:add_tag(add_tags[j])
			end
		end
		local remove_tags<const> = marker.remove_tags
		if remove_tags ~= nil then
			for j = 1, #remove_tags do
				owner:remove_tag(remove_tags[j])
			end
		end
		if marker.event ~= nil then
			owner.events:emit(marker.event, marker.payload)
		end
	end
end

local dispatch_frame<const> = function(entry, owner, evt, dt_ms, on_frame_payload, context)
	local state<const> = entry.timelinedispatch_state
	local payload<const> = acquire_payload(state, state.frame_payloads)
	local scoped_event_type<const> = state.scoped_frame_event_type
	payload.frame_index = evt.current
	payload.frame_value = evt.value
	payload.rewound = evt.rewound
	payload.reason = evt.reason
	payload.direction = evt.direction
	payload.dt = dt_ms
	payload.time_ms = evt.time_ms
	apply_markers(entry, owner, evt.current)
	on_frame_payload(context, entry, owner, payload)

	owner.events:emit('timeline.frame', payload)
	owner.events:emit(scoped_event_type, payload)
	state.depth = state.depth - 1
end

local dispatch_end<const> = function(entry, owner, evt)
	local state<const> = entry.timelinedispatch_state
	local payload<const> = acquire_payload(state, state.end_payloads)
	local scoped_event_type<const> = state.scoped_end_event_type
	payload.mode = evt.mode
	payload.wrapped = evt.wrapped

	owner.events:emit('timeline.end', payload)
	owner.events:emit(scoped_event_type, payload)
	state.depth = state.depth - 1
	return evt.mode == 'once'
end

function timelinedispatch.init_entry(entry)
	local state = entry.timelinedispatch_state
	local timelineid<const> = entry.instance.id
	if state == nil then
		local frame_payloads<const> = scratch_record_batch.new(1)
		local frame_payload<const> = frame_payloads.items[1]
		frame_payload.timelineid = timelineid
		frame_payload.frame_index = 0
		frame_payload.frame_value = false
		frame_payload.rewound = false
		frame_payload.reason = false
		frame_payload.direction = 0
		frame_payload.dt = 0
		frame_payload.time_ms = 0
		local end_payloads<const> = scratch_record_batch.new(1)
		local end_payload<const> = end_payloads.items[1]
		end_payload.timelineid = timelineid
		end_payload.mode = false
		end_payload.wrapped = false
		state = {
			frame_payloads = frame_payloads,
			end_payloads = end_payloads,
			depth = 0,
			timelineid = timelineid,
			scoped_frame_event_type = 'timeline.frame.' .. timelineid,
			scoped_end_event_type = 'timeline.end.' .. timelineid,
		}
		entry.timelinedispatch_state = state
	else
		state.timelineid = timelineid
		state.scoped_frame_event_type = 'timeline.frame.' .. timelineid
		state.scoped_end_event_type = 'timeline.end.' .. timelineid
	end
end

function timelinedispatch.process_instance_events(entry, owner, dt_ms, on_frame_payload, context)
	local instance<const> = entry.instance
	local stop = false
	for i = 1, instance.step_event_count do
		local evt<const> = instance.step_events[i]
		if evt.kind == 'frame' then
			dispatch_frame(entry, owner, evt, dt_ms, on_frame_payload, context)
		else
			if dispatch_end(entry, owner, evt) then
				stop = true
				break
			end
		end
	end
	return stop
end

return timelinedispatch
