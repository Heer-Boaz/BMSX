local scratchrecordbatch<const> = require('scratchrecordbatch')

local timeline_dispatch<const> = {}

local bind_slot<const> = function(slot, owner, timeline_id)
	local frame_payload = slot.frame_payload
	if frame_payload == nil then
		frame_payload = {}
		slot.frame_payload = frame_payload
	end
	frame_payload.timeline_id = timeline_id
	local end_payload = slot.end_payload
	if end_payload == nil then
		end_payload = {}
		slot.end_payload = end_payload
	end
	end_payload.timeline_id = timeline_id

	local base_frame_event = slot.base_frame_event
	if base_frame_event == nil then
		base_frame_event = {}
		slot.base_frame_event = base_frame_event
	end
	base_frame_event.type = 'timeline.frame'
	base_frame_event.emitter = owner
	base_frame_event.timeline_id = timeline_id

	local scoped_frame_event = slot.scoped_frame_event
	if scoped_frame_event == nil then
		scoped_frame_event = {}
		slot.scoped_frame_event = scoped_frame_event
	end
	scoped_frame_event.type = 'timeline.frame.' .. timeline_id
	scoped_frame_event.emitter = owner
	scoped_frame_event.timeline_id = timeline_id

	local base_end_event = slot.base_end_event
	if base_end_event == nil then
		base_end_event = {}
		slot.base_end_event = base_end_event
	end
	base_end_event.type = 'timeline.end'
	base_end_event.emitter = owner
	base_end_event.timeline_id = timeline_id

	local scoped_end_event = slot.scoped_end_event
	if scoped_end_event == nil then
		scoped_end_event = {}
		slot.scoped_end_event = scoped_end_event
	end
	scoped_end_event.type = 'timeline.end.' .. timeline_id
	scoped_end_event.emitter = owner
	scoped_end_event.timeline_id = timeline_id

	local marker_event = slot.marker_event
	if marker_event == nil then
		marker_event = {}
		slot.marker_event = marker_event
	end
	marker_event.emitter = owner
end

local ensure_slot<const> = function(state, depth)
	local slot<const> = state.slots:get(depth)
	bind_slot(slot, state.owner, state.timeline_id)
	return slot
end

local acquire_slot<const> = function(entry)
	local state<const> = entry.timeline_dispatch_state
	local depth<const> = state.depth + 1
	state.depth = depth
	return ensure_slot(state, depth)
end

local release_slot<const> = function(entry)
	local state<const> = entry.timeline_dispatch_state
	state.depth = state.depth - 1
end

local emit_and_dispatch<const> = function(owner, event)
	owner.events:emit_event(event)
end

local fill_marker_event<const> = function(slot, marker)
	local event<const> = slot.marker_event
	event.type = marker.event
	event.payload = marker.payload
	return event
end

local apply_markers<const> = function(entry, owner, slot, frame_index)
	local bucket<const> = entry.markers.by_frame[frame_index]
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
			emit_and_dispatch(owner, fill_marker_event(slot, marker))
		end
	end
end

local dispatch_frame<const> = function(entry, owner, evt, dt_ms, on_frame_payload, context)
	local slot<const> = acquire_slot(entry)
	local payload<const> = slot.frame_payload
	local time_ms<const> = entry.instance.time_ms
	payload.frame_index = evt.current
	payload.frame_value = evt.value
	payload.rewound = evt.rewound
	payload.reason = evt.reason
	payload.direction = evt.direction
	payload.dt = dt_ms
	payload.dt_seconds = dt_ms / 1000
	payload.time_ms = time_ms
	payload.time_seconds = time_ms / 1000
	apply_markers(entry, owner, slot, evt.current)
	on_frame_payload(context, entry, owner, payload)

	local base_frame_event<const> = slot.base_frame_event
	base_frame_event.payload = payload
	emit_and_dispatch(owner, base_frame_event)

	local scoped_frame_event<const> = slot.scoped_frame_event
	scoped_frame_event.payload = payload
	emit_and_dispatch(owner, scoped_frame_event)
	release_slot(entry)
end

local dispatch_end<const> = function(entry, owner, evt)
	local slot<const> = acquire_slot(entry)
	local payload<const> = slot.end_payload
	payload.mode = evt.mode
	payload.wrapped = evt.wrapped

	local base_end_event<const> = slot.base_end_event
	base_end_event.payload = payload
	emit_and_dispatch(owner, base_end_event)

	local scoped_end_event<const> = slot.scoped_end_event
	scoped_end_event.payload = payload
	emit_and_dispatch(owner, scoped_end_event)
	release_slot(entry)
	return evt.mode == 'once'
end

function timeline_dispatch.init_entry(entry, owner)
	local state = entry.timeline_dispatch_state
	if state == nil then
		state = {
			slots = scratchrecordbatch.new(1),
			depth = 0,
		}
		entry.timeline_dispatch_state = state
	end
	state.owner = owner
	state.timeline_id = entry.instance.id
end

function timeline_dispatch.process_instance_events(entry, owner, dt_ms, on_frame_payload, context)
	local instance<const> = entry.instance
	if instance.step_has_frame_event then
		dispatch_frame(entry, owner, instance.step_frame_event, dt_ms, on_frame_payload, context)
	end
	if instance.step_has_end_event then
		return dispatch_end(entry, owner, instance.step_end_event)
	end
	return false
end

return timeline_dispatch
