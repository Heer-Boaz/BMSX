local scratchrecordbatch = require('scratchrecordbatch')

local timeline_dispatch = {}

local function collect_payload_keys(payload)
	local keys = {}
	for key in pairs(payload) do
		if key ~= 'type' and key ~= 'emitter' and key ~= 'timestamp' then
			keys[#keys + 1] = key
		end
	end
	return keys
end

local function prepare_markers(markers)
	local by_frame = markers.by_frame
	for _, bucket in pairs(by_frame) do
		for i = 1, #bucket do
			local marker = bucket[i]
			local payload = marker.payload
			if type(payload) == 'table' and payload.type == nil then
				marker.dispatch_payload_is_fields = true
				marker.dispatch_payload_keys = collect_payload_keys(payload)
			else
				marker.dispatch_payload_is_fields = false
				marker.dispatch_payload_keys = nil
			end
		end
	end
end

local function bind_slot(slot, owner, timeline_id)
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

local function clear_marker_event(slot)
	local marker_event = slot.marker_event
	if marker_event == nil then
		marker_event = {}
		slot.marker_event = marker_event
	end
	local keys = slot.marker_event_keys
	if keys ~= nil then
		for i = 1, #keys do
			marker_event[keys[i]] = nil
		end
		slot.marker_event_keys = nil
	end
	marker_event.payload = nil
end

local function ensure_slot(state, depth)
	local slot = state.slots:get(depth)
	bind_slot(slot, state.owner, state.timeline_id)
	return slot
end

local function acquire_slot(entry)
	local state = entry.timeline_dispatch_state
	local depth = state.depth + 1
	state.depth = depth
	return ensure_slot(state, depth)
end

local function release_slot(entry)
	local state = entry.timeline_dispatch_state
	state.depth = state.depth - 1
end

local function emit_and_dispatch(owner, event)
	owner.events:emit_event(event)
	owner.sc:dispatch(event)
end

local function fill_marker_event(slot, marker)
	local event = slot.marker_event
	clear_marker_event(slot)
	event.type = marker.event
	local payload = marker.payload
	if payload == nil then
		return event
	end
	if marker.dispatch_payload_is_fields then
		local keys = marker.dispatch_payload_keys
		for i = 1, #keys do
			local key = keys[i]
			event[key] = payload[key]
		end
		slot.marker_event_keys = keys
		return event
	end
	event.payload = payload
	return event
end

local function apply_markers(entry, owner, slot, frame_index)
	local bucket = entry.markers.by_frame[frame_index]
	if bucket == nil then
		return
	end
	for i = 1, #bucket do
		local marker = bucket[i]
		local add_tags = marker.add_tags
		if add_tags ~= nil then
			for j = 1, #add_tags do
				owner:add_tag(add_tags[j])
			end
		end
		local remove_tags = marker.remove_tags
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

local function dispatch_frame(entry, owner, evt, dt_ms, on_frame_payload, context)
	local slot = acquire_slot(entry)
	local payload = slot.frame_payload
	local time_ms = entry.instance.time_ms
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

	local base_frame_event = slot.base_frame_event
	base_frame_event.frame_index = payload.frame_index
	base_frame_event.frame_value = payload.frame_value
	base_frame_event.rewound = payload.rewound
	base_frame_event.reason = payload.reason
	base_frame_event.direction = payload.direction
	emit_and_dispatch(owner, base_frame_event)

	local scoped_frame_event = slot.scoped_frame_event
	scoped_frame_event.frame_index = payload.frame_index
	scoped_frame_event.frame_value = payload.frame_value
	scoped_frame_event.rewound = payload.rewound
	scoped_frame_event.reason = payload.reason
	scoped_frame_event.direction = payload.direction
	emit_and_dispatch(owner, scoped_frame_event)
	release_slot(entry)
end

local function dispatch_end(entry, owner, evt)
	local slot = acquire_slot(entry)
	local payload = slot.end_payload
	payload.mode = evt.mode
	payload.wrapped = evt.wrapped

	local base_end_event = slot.base_end_event
	base_end_event.mode = payload.mode
	base_end_event.wrapped = payload.wrapped
	emit_and_dispatch(owner, base_end_event)

	local scoped_end_event = slot.scoped_end_event
	scoped_end_event.mode = payload.mode
	scoped_end_event.wrapped = payload.wrapped
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
	prepare_markers(entry.markers)
end

function timeline_dispatch.process_instance_events(entry, owner, dt_ms, on_frame_payload, context)
	local instance = entry.instance
	if instance.step_has_frame_event then
		dispatch_frame(entry, owner, instance.step_frame_event, dt_ms, on_frame_payload, context)
	end
	if instance.step_has_end_event then
		return dispatch_end(entry, owner, instance.step_end_event)
	end
	return false
end

return timeline_dispatch
