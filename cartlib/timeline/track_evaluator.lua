-- Runtime track evaluation is split into persistent, sampled, and one-shot
-- phases. Compiled programs contain every lookup table used below; no authored
-- track kind or binding name is inspected on the update path.
local timeline_module<const> = require('cartlib/timeline/timeline')

local track_evaluator<const> = {}
local play_update_method<const> = timeline_module.update_method.play

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

local first_time_after<const> = function(records, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if records[middle].time_ms <= time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local first_time_at<const> = function(records, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if records[middle].time_ms < time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local emit_event_bucket<const> = function(events, owner, frame, direction)
	local bucket<const> = events.by_frame[frame]
	if bucket == nil then
		return
	end
	if direction > 0 then
		for index = 1, #bucket do
			local key<const> = bucket[index]
			if key.forward then
				owner.events:emit(key.event, key.payload)
			end
		end
	else
		for index = #bucket, 1, -1 do
			local key<const> = bucket[index]
			if key.backward then
				owner.events:emit(key.event, key.payload)
			end
		end
	end
end

local emit_event_range<const> = function(events, owner, previous, current, direction, include_previous)
	local keys<const> = events.keys
	local count<const> = events.count
	if direction > 0 then
		local first
		if include_previous then
			first = first_frame_at(keys, count, previous)
		else
			first = first_frame_after(keys, count, previous)
		end
		local finish<const> = first_frame_after(keys, count, current) - 1
		for index = first, finish do
			local key<const> = keys[index]
			if key.forward then
				owner.events:emit(key.event, key.payload)
			end
		end
	else
		local first
		if include_previous then
			first = first_frame_after(keys, count, previous) - 1
		else
			first = first_frame_at(keys, count, previous) - 1
		end
		local finish<const> = first_frame_at(keys, count, current)
		for index = first, finish, -1 do
			local key<const> = keys[index]
			if key.backward then
				owner.events:emit(key.event, key.payload)
			end
		end
	end
end

local emit_time_event_range<const> = function(events, owner, previous, current, direction, include_previous)
	local keys<const> = events.time_keys
	local count<const> = events.time_count
	if direction > 0 then
		local first
		if include_previous then
			first = first_time_at(keys, count, previous)
		else
			first = first_time_after(keys, count, previous)
		end
		local finish<const> = first_time_after(keys, count, current) - 1
		for index = first, finish do
			local key<const> = keys[index]
			if key.forward then
				owner.events:emit(key.event, key.payload)
			end
		end
	elseif direction < 0 then
		local first
		if include_previous then
			first = first_time_after(keys, count, previous) - 1
		else
			first = first_time_at(keys, count, previous) - 1
		end
		local finish<const> = first_time_at(keys, count, current)
		for index = first, finish, -1 do
			local key<const> = keys[index]
			if key.backward then
				owner.events:emit(key.event, key.payload)
			end
		end
	end
end

function track_evaluator.emit_events(entry, owner, evaluation)
	if evaluation.method ~= play_update_method then
		return
	end
	local program<const> = entry.instance.program
	local events<const> = program.tracks.events
	local previous<const> = evaluation.previous_frame
	local current<const> = evaluation.frame
	if evaluation.wrapped then
		if evaluation.direction > 0 then
			emit_event_range(events, owner, previous, program.length - 1, 1, evaluation.initial)
			emit_event_range(events, owner, 0, current, 1, true)
		else
			emit_event_range(events, owner, previous, 0, -1, evaluation.initial)
			emit_event_range(events, owner, program.length - 1, current, -1, true)
		end
	elseif evaluation.initial then
		emit_event_range(events, owner, previous, current, evaluation.direction, true)
	elseif previous ~= current then
		if evaluation.direction > 0 and current == previous + 1 then
			emit_event_bucket(events, owner, current, 1)
		elseif evaluation.direction < 0 and current == previous - 1 then
			emit_event_bucket(events, owner, current, -1)
		else
			emit_event_range(events, owner, previous, current, evaluation.direction, false)
		end
	end
	if events.time_count == 0 then
		return
	end
	local previous_time_ms<const> = evaluation.previous_time_ms
	local time_ms<const> = evaluation.time_ms
	if evaluation.wrapped then
		if evaluation.direction > 0 then
			emit_time_event_range(events, owner, previous_time_ms, program.duration_ms, 1, evaluation.initial)
			emit_time_event_range(events, owner, 0, time_ms, 1, true)
		else
			emit_time_event_range(events, owner, previous_time_ms, 0, -1, evaluation.initial)
			emit_time_event_range(events, owner, program.duration_ms, time_ms, -1, true)
		end
	elseif evaluation.initial then
		emit_time_event_range(events, owner, previous_time_ms, time_ms, evaluation.direction, true)
	elseif previous < 0 then
		emit_time_event_range(events, owner, previous_time_ms, time_ms, 1, true)
	else
		emit_time_event_range(events, owner, previous_time_ms, time_ms, evaluation.direction, false)
	end
end

local apply_tag_boundary<const> = function(entry, owner, boundary, direction)
	local state<const> = entry.track_state
	local interval<const> = boundary.interval
	local tag_index<const> = interval.tag_index
	local counts<const> = state.tag_counts
	local previous_count<const> = counts[tag_index]
	local delta<const> = boundary.delta * direction
	local current_count<const> = previous_count + delta
	counts[tag_index] = current_count
	local tag<const> = entry.instance.program.tracks.tags.tags[tag_index]
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

local apply_tag_bucket<const> = function(entry, owner, frame, direction)
	local bucket<const> = entry.instance.program.tracks.tags.boundaries_by_frame[frame]
	if bucket == nil then
		return
	end
	if direction > 0 then
		for index = 1, #bucket do
			apply_tag_boundary(entry, owner, bucket[index], direction)
		end
	else
		for index = #bucket, 1, -1 do
			apply_tag_boundary(entry, owner, bucket[index], direction)
		end
	end
end

local apply_tag_range<const> = function(
	entry,
	owner,
	previous,
	current,
	direction,
	include_previous,
	include_current
)
	local tags<const> = entry.instance.program.tracks.tags
	local boundaries<const> = tags.boundaries
	local count<const> = tags.boundary_count
	if direction > 0 then
		local first
		if include_previous then
			first = first_frame_at(boundaries, count, previous)
		else
			first = first_frame_after(boundaries, count, previous)
		end
		local finish
		if include_current then
			finish = first_frame_after(boundaries, count, current) - 1
		else
			finish = first_frame_at(boundaries, count, current) - 1
		end
		for index = first, finish do
			apply_tag_boundary(entry, owner, boundaries[index], direction)
		end
	else
		local first
		if include_previous then
			first = first_frame_after(boundaries, count, previous) - 1
		else
			first = first_frame_at(boundaries, count, previous) - 1
		end
		local finish
		if include_current then
			finish = first_frame_at(boundaries, count, current)
		else
			finish = first_frame_after(boundaries, count, current)
		end
		for index = first, finish, -1 do
			apply_tag_boundary(entry, owner, boundaries[index], direction)
		end
	end
end

local apply_time_tag_range<const> = function(
	entry,
	owner,
	previous,
	current,
	direction,
	include_previous,
	include_current
)
	local tags<const> = entry.instance.program.tracks.tags
	local boundaries<const> = tags.time_boundaries
	local count<const> = tags.time_boundary_count
	if direction > 0 then
		local first
		if include_previous then
			first = first_time_at(boundaries, count, previous)
		else
			first = first_time_after(boundaries, count, previous)
		end
		local finish
		if include_current then
			finish = first_time_after(boundaries, count, current) - 1
		else
			finish = first_time_at(boundaries, count, current) - 1
		end
		for index = first, finish do
			apply_tag_boundary(entry, owner, boundaries[index], direction)
		end
	elseif direction < 0 then
		local first
		if include_previous then
			first = first_time_after(boundaries, count, previous) - 1
		else
			first = first_time_at(boundaries, count, previous) - 1
		end
		local finish
		if include_current then
			finish = first_time_at(boundaries, count, current)
		else
			finish = first_time_after(boundaries, count, current)
		end
		for index = first, finish, -1 do
			apply_tag_boundary(entry, owner, boundaries[index], direction)
		end
	end
end

function track_evaluator.sync_tags(entry, owner, frame, time_ms)
	local tags<const> = entry.instance.program.tracks.tags
	if tags.tag_count == 0 then
		return
	end
	local state<const> = entry.track_state
	local target_counts<const> = state.target_tag_counts
	for index = 1, tags.tag_count do
		target_counts[index] = 0
	end
	for index = 1, tags.interval_count do
		local interval<const> = tags.intervals[index]
		if frame >= interval.start_frame and frame < interval.end_frame then
			local tag_index<const> = interval.tag_index
			target_counts[tag_index] = target_counts[tag_index] + 1
		end
	end
	for index = 1, tags.time_interval_count do
		local interval<const> = tags.time_intervals[index]
		if time_ms >= interval.start_time_ms and time_ms < interval.end_time_ms then
			local tag_index<const> = interval.tag_index
			target_counts[tag_index] = target_counts[tag_index] + 1
		end
	end
	local counts<const> = state.tag_counts
	for index = 1, tags.tag_count do
		local previous_count<const> = counts[index]
		local current_count<const> = target_counts[index]
		if previous_count == 0 and current_count > 0 then
			owner:add_tag(tags.tags[index])
		elseif previous_count > 0 and current_count == 0 then
			owner:remove_tag(tags.tags[index])
		end
		counts[index] = current_count
	end
end

function track_evaluator.evaluate_tags(entry, owner, evaluation)
	local program<const> = entry.instance.program
	if evaluation.method ~= play_update_method then
		track_evaluator.sync_tags(entry, owner, evaluation.frame, evaluation.time_ms)
		return
	end
	local previous<const> = evaluation.previous_frame
	local current<const> = evaluation.frame
	if evaluation.initial then
		track_evaluator.sync_tags(entry, owner, previous, evaluation.previous_time_ms)
	end
	if previous ~= current or evaluation.wrapped then
		if evaluation.wrapped then
			if evaluation.direction > 0 then
				apply_tag_range(entry, owner, previous, program.length - 1, 1, false, true)
				apply_tag_range(entry, owner, 0, current, 1, true, true)
			else
				apply_tag_range(entry, owner, previous, 0, -1, true, true)
				local last_frame<const> = program.length - 1
				apply_tag_range(entry, owner, last_frame, current, -1, false, false)
			end
		elseif evaluation.direction > 0 and current == previous + 1 then
			apply_tag_bucket(entry, owner, current, 1)
		elseif evaluation.direction < 0 and current == previous - 1 then
			apply_tag_bucket(entry, owner, previous, -1)
		else
			if evaluation.direction > 0 then
				apply_tag_range(entry, owner, previous, current, 1, false, true)
			else
				apply_tag_range(entry, owner, previous, current, -1, true, false)
			end
		end
	end
	if program.tracks.tags.time_boundary_count == 0 then
		return
	end
	local previous_time_ms<const> = evaluation.previous_time_ms
	local time_ms<const> = evaluation.time_ms
	if evaluation.wrapped then
		if evaluation.direction > 0 then
			apply_time_tag_range(entry, owner, previous_time_ms, program.duration_ms, 1, false, true)
			apply_time_tag_range(entry, owner, 0, time_ms, 1, true, true)
		else
			apply_time_tag_range(entry, owner, previous_time_ms, 0, -1, true, true)
			apply_time_tag_range(entry, owner, program.duration_ms, time_ms, -1, false, false)
		end
	elseif previous < 0 then
		apply_time_tag_range(entry, owner, previous_time_ms, time_ms, 1, true, true)
	else
		if evaluation.direction > 0 then
			apply_time_tag_range(entry, owner, previous_time_ms, time_ms, 1, false, true)
		elseif evaluation.direction < 0 then
			apply_time_tag_range(entry, owner, previous_time_ms, time_ms, -1, true, false)
		end
	end
end

local apply_step_key<const> = function(entry, key, params, evaluation)
	local track<const> = key.track
	local binding
	if track.binding_index == 1 then
		binding = entry.primary_binding
	else
		binding = entry.bindings[track.binding_index]
	end
	track.apply(binding, key.value, params, evaluation)
end

local apply_step_bucket<const> = function(entry, bucket, params, evaluation)
	if bucket == nil then
		return
	end
	for index = 1, #bucket do
		apply_step_key(entry, bucket[index], params, evaluation)
	end
end

local last_step_key_at<const> = function(track, frame)
	local keys<const> = track.keys
	local index<const> = first_frame_after(keys, track.key_count, frame) - 1
	return keys[index]
end

local sample_step_tracks<const> = function(entry, steps, frame, params, evaluation)
	local tracks<const> = steps.tracks
	for index = 1, steps.track_count do
		local key<const> = last_step_key_at(tracks[index], frame)
		if key ~= nil then
			apply_step_key(entry, key, params, evaluation)
		end
	end
end

local last_time_step_key_at<const> = function(track, time_ms)
	local keys<const> = track.keys
	local index<const> = first_time_after(keys, track.key_count, time_ms) - 1
	return keys[index]
end

local sample_time_step_tracks<const> = function(entry, steps, time_ms, params, evaluation)
	local tracks<const> = steps.time_tracks
	for index = 1, steps.time_track_count do
		local key<const> = last_time_step_key_at(tracks[index], time_ms)
		if key ~= nil then
			apply_step_key(entry, key, params, evaluation)
		end
	end
end

local apply_time_step_range<const> = function(entry, steps, previous_time_ms, time_ms, params, evaluation)
	local keys<const> = steps.time_keys
	local first<const> = first_time_after(keys, steps.time_key_count, previous_time_ms)
	local finish<const> = first_time_after(keys, steps.time_key_count, time_ms) - 1
	for index = first, finish do
		apply_step_key(entry, keys[index], params, evaluation)
	end
end

function track_evaluator.evaluate_values(entry, evaluation)
	local tracks<const> = entry.instance.program.tracks
	local params<const> = entry.params
	local steps<const> = tracks.steps
	if evaluation.sample and steps.track_count > 0 then
		local previous<const> = evaluation.previous_frame
		local current<const> = evaluation.frame
		if evaluation.initial
		or evaluation.method ~= play_update_method
			or evaluation.wrapped
			or current > previous + 1
			or current < previous - 1 then
			sample_step_tracks(entry, steps, current, params, evaluation)
		elseif evaluation.direction > 0 then
			apply_step_bucket(entry, steps.by_frame[current], params, evaluation)
		elseif evaluation.direction < 0 then
			apply_step_bucket(entry, steps.reverse_by_frame[previous], params, evaluation)
		end
	end
	if steps.time_track_count > 0 then
		local previous_time_ms<const> = evaluation.previous_time_ms
		local time_ms<const> = evaluation.time_ms
		if evaluation.initial
		or evaluation.method ~= play_update_method
			or evaluation.wrapped
			or evaluation.previous_frame < 0
			or time_ms <= previous_time_ms then
			sample_time_step_tracks(entry, steps, time_ms, params, evaluation)
		else
			apply_time_step_range(entry, steps, previous_time_ms, time_ms, params, evaluation)
		end
	end
	local scalar_channels<const> = tracks.scalar_channels
	if scalar_channels.track_count > 0 then
		scalar_channels.runner(scalar_channels, entry, evaluation)
	end
	if not evaluation.sample then
		return
	end
	local time_seconds<const> = evaluation.time_ms * 0.001
	local primary_sample_runner<const> = tracks.primary_sample_runner
	if primary_sample_runner ~= nil then
		primary_sample_runner(entry.primary_binding, params, evaluation, time_seconds)
	elseif tracks.sample_group_count > 0 then
		local bindings<const> = entry.bindings
		local groups<const> = tracks.sample_groups
		for index = 1, tracks.sample_group_count do
			local group<const> = groups[index]
			group.runner(bindings[group.binding_index], params, evaluation, time_seconds)
		end
	end
end

function track_evaluator.init_entry(entry)
	local tag_count<const> = entry.instance.program.tracks.tags.tag_count
	if tag_count == 0 then
		return
	end
	local state = entry.track_state
	if state == nil then
		state = { tag_counts = {}, target_tag_counts = {} }
		entry.track_state = state
	end
	for index = 1, tag_count do
		state.tag_counts[index] = 0
		state.target_tag_counts[index] = 0
	end
end

function track_evaluator.clear_tags(entry, owner)
	local tags<const> = entry.instance.program.tracks.tags
	if tags.tag_count == 0 then
		return
	end
	local counts<const> = entry.track_state.tag_counts
	for index = 1, tags.tag_count do
		if counts[index] > 0 then
			owner:remove_tag(tags.tags[index])
		end
		counts[index] = 0
	end
end

return track_evaluator
