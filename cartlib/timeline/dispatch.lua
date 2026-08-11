local scratch_record_batch<const> = require('cartlib/util/scratch_record_batch')

local timeline_dispatch<const> = {}

local acquire_payload<const> = function(state, payloads)
	local depth<const> = state.depth + 1
	state.depth = depth
	local payload<const> = payloads:get(depth)
	payload.timeline_id = state.timeline_id
	return payload
end

local first_frame_after<const> = function(records, count, frame)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if records[middle].frame <= frame then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local first_frame_at<const> = function(records, count, frame)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if records[middle].frame < frame then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local emit_marker_bucket<const> = function(markers, owner, frame, direction)
	local bucket<const> = markers.by_frame[frame]
	if bucket == nil then
		return
	end
	for index = 1, #bucket do
		local marker<const> = bucket[index]
		if direction > 0 and marker.forward or direction < 0 and marker.backward then
			owner.events:emit(marker.event, marker.payload)
		end
	end
end

local emit_marker_range<const> = function(markers, owner, previous, current, direction)
	local records<const> = markers.markers
	local count<const> = markers.count
	if direction > 0 then
		local first<const> = first_frame_after(records, count, previous)
		local finish<const> = first_frame_after(records, count, current) - 1
		for index = first, finish do
			local marker<const> = records[index]
			if marker.forward then
				owner.events:emit(marker.event, marker.payload)
			end
		end
	else
		local first<const> = first_frame_at(records, count, previous) - 1
		local finish<const> = first_frame_at(records, count, current)
		for index = first, finish, -1 do
			local marker<const> = records[index]
			if marker.backward then
				owner.events:emit(marker.event, marker.payload)
			end
		end
	end
end

local emit_traversed_markers<const> = function(program, owner, evaluation)
	if evaluation.jumped or evaluation.previous == evaluation.current then
		return
	end
	local markers<const> = program.markers
	local previous<const> = evaluation.previous
	local current<const> = evaluation.current
	if evaluation.wrapped then
		emit_marker_range(markers, owner, previous, program.length - 1, 1)
		emit_marker_range(markers, owner, -1, current, 1)
	elseif evaluation.direction > 0 and current == previous + 1 then
		emit_marker_bucket(markers, owner, current, 1)
	elseif evaluation.direction < 0 and current == previous - 1 then
		emit_marker_bucket(markers, owner, current, -1)
	else
		emit_marker_range(markers, owner, previous, current, evaluation.direction)
	end
end

local apply_window_boundary<const> = function(entry, owner, boundary, direction)
	local state<const> = entry.timeline_dispatch_state
	local interval<const> = boundary.interval
	local tag_index<const> = interval.tag_index
	local counts<const> = state.window_tag_counts
	local previous_count<const> = counts[tag_index]
	local delta<const> = boundary.delta * direction
	local current_count<const> = previous_count + delta
	counts[tag_index] = current_count
	local tag<const> = entry.instance.program.windows.tags[tag_index]
	if previous_count == 0 and current_count > 0 then
		owner:add_tag(tag)
	elseif previous_count > 0 and current_count == 0 then
		owner:remove_tag(tag)
	end
	if delta > 0 then
		owner.events:emit(interval.start_event, interval.start_payload)
	else
		owner.events:emit(interval.end_event, interval.end_payload)
	end
end

local apply_window_bucket<const> = function(entry, owner, frame, direction)
	local bucket<const> = entry.instance.program.windows.boundaries_by_frame[frame]
	if bucket == nil then
		return
	end
	if direction > 0 then
		for index = 1, #bucket do
			apply_window_boundary(entry, owner, bucket[index], direction)
		end
	else
		for index = #bucket, 1, -1 do
			apply_window_boundary(entry, owner, bucket[index], direction)
		end
	end
end

local apply_window_range<const> = function(entry, owner, previous, current, direction)
	local windows<const> = entry.instance.program.windows
	local boundaries<const> = windows.boundaries
	local count<const> = windows.boundary_count
	if direction > 0 then
		local first<const> = first_frame_after(boundaries, count, previous)
		local finish<const> = first_frame_after(boundaries, count, current) - 1
		for index = first, finish do
			apply_window_boundary(entry, owner, boundaries[index], direction)
		end
	else
		local first<const> = first_frame_after(boundaries, count, previous) - 1
		local finish<const> = first_frame_after(boundaries, count, current)
		for index = first, finish, -1 do
			apply_window_boundary(entry, owner, boundaries[index], direction)
		end
	end
end

local sync_windows_at<const> = function(entry, owner, frame)
	local windows<const> = entry.instance.program.windows
	local state<const> = entry.timeline_dispatch_state
	local target_counts<const> = state.window_target_counts
	for index = 1, windows.tag_count do
		target_counts[index] = 0
	end
	for index = 1, windows.interval_count do
		local interval<const> = windows.intervals[index]
		if frame >= interval.start_frame and frame < interval.end_frame then
			local tag_index<const> = interval.tag_index
			target_counts[tag_index] = target_counts[tag_index] + 1
		end
	end
	local counts<const> = state.window_tag_counts
	for index = 1, windows.tag_count do
		local previous_count<const> = counts[index]
		local current_count<const> = target_counts[index]
		if previous_count == 0 and current_count > 0 then
			owner:add_tag(windows.tags[index])
		elseif previous_count > 0 and current_count == 0 then
			owner:remove_tag(windows.tags[index])
		end
		counts[index] = current_count
	end
end

local apply_timeline_windows<const> = function(entry, owner, evaluation)
	if evaluation.jumped then
		sync_windows_at(entry, owner, evaluation.current)
		return
	end
	local previous<const> = evaluation.previous
	local current<const> = evaluation.current
	if previous == current then
		return
	end
	if evaluation.wrapped then
		apply_window_range(entry, owner, previous, entry.instance.program.length - 1, 1)
		apply_window_range(entry, owner, -1, current, 1)
	elseif evaluation.direction > 0 and current == previous + 1 then
		apply_window_bucket(entry, owner, current, 1)
	elseif evaluation.direction < 0 and current == previous - 1 then
		apply_window_bucket(entry, owner, previous, -1)
	else
		apply_window_range(entry, owner, previous, current, evaluation.direction)
	end
end

local dispatch_frame<const> = function(entry, owner, evaluation, delta_time, on_frame_payload, context)
	local state<const> = entry.timeline_dispatch_state
	local payload<const> = acquire_payload(state, state.frame_payloads)
	payload.previous_frame = evaluation.previous
	payload.frame_index = evaluation.current
	payload.frame_value = evaluation.value
	payload.reason = evaluation.reason
	payload.direction = evaluation.direction
	payload.jumped = evaluation.jumped
	payload.wrapped = evaluation.wrapped
	payload.delta_time = delta_time
	payload.time_ms = evaluation.time_ms
	local program<const> = entry.instance.program
	if program.markers.count > 0 then
		emit_traversed_markers(program, owner, evaluation)
	end
	if program.windows.interval_count > 0 then
		apply_timeline_windows(entry, owner, evaluation)
	end
	on_frame_payload(context, entry, owner, payload)
	owner.events:emit(state.scoped_frame_event_type, payload)
	state.depth = state.depth - 1
end

local dispatch_end<const> = function(entry, owner, evaluation)
	local state<const> = entry.timeline_dispatch_state
	local payload<const> = acquire_payload(state, state.end_payloads)
	local program<const> = entry.instance.program
	payload.frame_index = evaluation.current
	payload.mode = program.playback_mode
	payload.wrapped = evaluation.wrapped
	payload.time_ms = evaluation.time_ms
	owner.events:emit(state.scoped_end_event_type, payload)
	state.depth = state.depth - 1
	return program.playback_mode == 'once'
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
		frame_payload.reason = false
		frame_payload.direction = 0
		frame_payload.jumped = false
		frame_payload.wrapped = false
		frame_payload.delta_time = 0
		frame_payload.time_ms = 0
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
	local tag_count<const> = entry.instance.program.windows.tag_count
	if tag_count > 0 then
		local counts = state.window_tag_counts
		local target_counts = state.window_target_counts
		if counts == nil then
			counts = {}
			target_counts = {}
			state.window_tag_counts = counts
			state.window_target_counts = target_counts
		end
		for index = 1, tag_count do
			counts[index] = 0
			target_counts[index] = 0
		end
	end
end

function timeline_dispatch.clear_windows(entry, owner)
	local state<const> = entry.timeline_dispatch_state
	local windows<const> = entry.instance.program.windows
	for index = 1, windows.tag_count do
		if state.window_tag_counts[index] > 0 then
			owner:remove_tag(windows.tags[index])
		end
		state.window_tag_counts[index] = 0
	end
end

function timeline_dispatch.sync_windows(entry, owner, frame)
	sync_windows_at(entry, owner, frame)
end

function timeline_dispatch.process_instance_evaluations(entry, owner, delta_time, on_frame_payload, context)
	local instance<const> = entry.instance
	local stop = false
	for index = 1, instance.evaluation_count do
		local evaluation<const> = instance.evaluations[index]
		if evaluation.sample then
			dispatch_frame(entry, owner, evaluation, delta_time, on_frame_payload, context)
		end
		if evaluation.ended and dispatch_end(entry, owner, evaluation) then
			stop = true
			break
		end
	end
	return stop
end

return timeline_dispatch
