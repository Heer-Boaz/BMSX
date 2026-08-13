-- Runtime track evaluation is split into persistent, sampled, and one-shot
-- phases. Compiled programs contain every lookup table used below; no authored
-- track kind or binding name is inspected on the update path.
local easing<const> = require('cartlib/easing')
local track_evaluator_syntax<const> = require('cartlib/timeline/track_evaluator_syntax')
local timeline_playback<const> = require('cartlib/timeline/playback')

local track_evaluator<const> = {}
local compile_syntax<const> = lua_compiler.compile_syntax
local pingpong01<const> = easing.pingpong01
local sin<const> = math.sin
local tau<const> = math.pi * 2
local evaluation_flag<const> = timeline_playback.evaluation_flag
local sample_flag<const> = evaluation_flag.sample
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial
local reset_step_flags<const> = wrapped_flag | initial_flag

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

local emit_event_bucket<const> = function(lane, owner, frame, direction)
	local bucket<const> = lane.by_frame[frame]
	if bucket == nil then
		return
	end
	if direction > 0 then
		for index = 1, #bucket do
			local key<const> = bucket[index]
			owner.events:emit(key.event, key.payload)
		end
	else
		for index = #bucket, 1, -1 do
			local key<const> = bucket[index]
			owner.events:emit(key.event, key.payload)
		end
	end
end

local emit_event_range<const> = function(lane, owner, previous, current, direction, include_previous)
	local keys<const> = lane.keys
	local count<const> = lane.count
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
			owner.events:emit(key.event, key.payload)
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
			owner.events:emit(key.event, key.payload)
		end
	end
end

local emit_time_event_range<const> = function(lane, owner, previous, current, direction, include_previous)
	local keys<const> = lane.time_keys
	local count<const> = lane.time_count
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
			owner.events:emit(key.event, key.payload)
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
			owner.events:emit(key.event, key.payload)
		end
	end
end

function track_evaluator.bind_events(program, method)
	local events<const> = program.tracks.events[method + 1]
	local last_frame<const> = program.last_frame
	local duration_ms<const> = program.duration_ms
	return function(owner, previous, current, previous_time_ms, time_ms, direction, flags)
		local lane = events.backward
		if direction > 0 then
			lane = events.forward
		end
		if flags & wrapped_flag ~= 0 then
			if direction > 0 then
				emit_event_range(lane, owner, previous, last_frame, 1, flags & initial_flag ~= 0)
				emit_event_range(lane, owner, 0, current, 1, true)
			else
				emit_event_range(lane, owner, previous, 0, -1, flags & initial_flag ~= 0)
				emit_event_range(lane, owner, last_frame, current, -1, true)
			end
		elseif flags & initial_flag ~= 0 then
			emit_event_range(lane, owner, previous, current, direction, true)
		elseif previous ~= current then
			if direction > 0 and current == previous + 1 then
				emit_event_bucket(lane, owner, current, 1)
			elseif direction < 0 and current == previous - 1 then
				emit_event_bucket(lane, owner, current, -1)
			else
				emit_event_range(lane, owner, previous, current, direction, false)
			end
		end
		if lane.time_count == 0 then
			return
		end
		if flags & wrapped_flag ~= 0 then
			if direction > 0 then
				emit_time_event_range(lane, owner, previous_time_ms, duration_ms, 1, flags & initial_flag ~= 0)
				emit_time_event_range(lane, owner, 0, time_ms, 1, true)
			else
				emit_time_event_range(lane, owner, previous_time_ms, 0, -1, flags & initial_flag ~= 0)
				emit_time_event_range(lane, owner, duration_ms, time_ms, -1, true)
			end
		elseif flags & initial_flag ~= 0 then
			emit_time_event_range(lane, owner, previous_time_ms, time_ms, direction, true)
		else
			emit_time_event_range(lane, owner, previous_time_ms, time_ms, direction, false)
		end
	end
end

local apply_tag_boundary<const> = function(tags, entry, owner, boundary, direction)
	local state<const> = entry.track_state
	local interval<const> = boundary.interval
	local tag_index<const> = interval.tag_index
	local counts<const> = state.tag_counts
	local previous_count<const> = counts[tag_index]
	local delta<const> = boundary.delta * direction
	local current_count<const> = previous_count + delta
	counts[tag_index] = current_count
	local tag<const> = tags.tags[tag_index]
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

local apply_tag_bucket<const> = function(tags, entry, owner, frame, direction)
	local bucket<const> = tags.boundaries_by_frame[frame]
	if bucket == nil then
		return
	end
	if direction > 0 then
		for index = 1, #bucket do
			apply_tag_boundary(tags, entry, owner, bucket[index], direction)
		end
	else
		for index = #bucket, 1, -1 do
			apply_tag_boundary(tags, entry, owner, bucket[index], direction)
		end
	end
end

local apply_tag_range<const> = function(
	tags,
	entry,
	owner,
	previous,
	current,
	direction,
	include_previous,
	include_current
)
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
			apply_tag_boundary(tags, entry, owner, boundaries[index], direction)
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
			apply_tag_boundary(tags, entry, owner, boundaries[index], direction)
		end
	end
end

local apply_time_tag_range<const> = function(
	tags,
	entry,
	owner,
	previous,
	current,
	direction,
	include_previous,
	include_current
)
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
			apply_tag_boundary(tags, entry, owner, boundaries[index], direction)
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
			apply_tag_boundary(tags, entry, owner, boundaries[index], direction)
		end
	end
end

local sync_tags<const> = function(tags, entry, owner, frame, time_ms)
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

function track_evaluator.sync_tags(entry, owner, frame, time_ms)
	sync_tags(entry.instance.program.tracks.tags, entry, owner, frame, time_ms)
end

function track_evaluator.bind_position_tags(program)
	local tags<const> = program.tracks.tags
	return function(entry, owner, frame, time_ms)
		sync_tags(tags, entry, owner, frame, time_ms)
	end
end

function track_evaluator.bind_play_tags(program)
	local tags<const> = program.tracks.tags
	local last_frame<const> = program.last_frame
	local duration_ms<const> = program.duration_ms
	return function(entry, owner, previous, current, previous_time_ms, time_ms, direction, flags)
		-- A nested clip enters at a mapped source position and must synchronize
		-- that source. The root sentinel instead denotes the instant before zero.
		if flags & initial_flag ~= 0 and previous >= 0 then
			sync_tags(tags, entry, owner, previous, previous_time_ms)
		end
		if previous ~= current or flags & wrapped_flag ~= 0 then
			if flags & wrapped_flag ~= 0 then
				if direction > 0 then
					apply_tag_range(tags, entry, owner, previous, last_frame, 1, false, true)
					apply_tag_range(tags, entry, owner, 0, current, 1, true, true)
				else
					apply_tag_range(tags, entry, owner, previous, 0, -1, true, true)
					apply_tag_range(tags, entry, owner, last_frame, current, -1, false, false)
				end
			elseif direction > 0 and current == previous + 1 then
				apply_tag_bucket(tags, entry, owner, current, 1)
			elseif direction < 0 and current == previous - 1 then
				apply_tag_bucket(tags, entry, owner, previous, -1)
			else
				if direction > 0 then
					apply_tag_range(tags, entry, owner, previous, current, 1, false, true)
				else
					apply_tag_range(tags, entry, owner, previous, current, -1, true, false)
				end
			end
		end
		if tags.time_boundary_count == 0 then
			return
		end
		if flags & wrapped_flag ~= 0 then
			if direction > 0 then
				apply_time_tag_range(tags, entry, owner, previous_time_ms, duration_ms, 1, false, true)
				apply_time_tag_range(tags, entry, owner, 0, time_ms, 1, true, true)
			else
				apply_time_tag_range(tags, entry, owner, previous_time_ms, 0, -1, true, true)
				apply_time_tag_range(tags, entry, owner, duration_ms, time_ms, -1, false, false)
			end
		elseif previous < 0 then
			apply_time_tag_range(tags, entry, owner, previous_time_ms, time_ms, 1, true, true)
		else
			if direction > 0 then
				apply_time_tag_range(tags, entry, owner, previous_time_ms, time_ms, 1, false, true)
			elseif direction < 0 then
				apply_time_tag_range(tags, entry, owner, previous_time_ms, time_ms, -1, true, false)
			end
		end
	end
end

local apply_step_bucket<const> = function(entry, bucket, params, evaluation)
	if bucket == nil then
		return
	end
	for index = 1, #bucket do
		local key<const> = bucket[index]
		key.apply(entry, key.value, params, evaluation)
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
			key.apply(entry, key.value, params, evaluation)
		end
	end
end

local last_time_step_key_at<const> = function(track, time_ms)
	local keys<const> = track.keys
	local index<const> = first_time_after(keys, track.key_count, time_ms) - 1
	return keys[index]
end

local position_time_step_cursor<const> = function(entry, steps, time_ms)
	local keys<const> = steps.time_keys
	local index<const> = first_time_after(keys, steps.time_key_count, time_ms)
	entry.previous_time_step_key = keys[index - 1]
	entry.next_time_step_key = keys[index]
end

local sample_time_step_tracks<const> = function(entry, steps, time_ms, params, evaluation)
	local tracks<const> = steps.time_tracks
	for index = 1, steps.time_track_count do
		local key<const> = last_time_step_key_at(tracks[index], time_ms)
		if key ~= nil then
			key.apply(entry, key.value, params, evaluation)
		end
	end
	position_time_step_cursor(entry, steps, time_ms)
end

function track_evaluator.compile_values(program)
	local has_frame_steps<const> = program.has_frame_steps
	local has_time_steps<const> = program.has_time_steps
	local scalar_program<const> = program.scalar_program
	local has_scalar_channels<const> = scalar_program.track_count > 0
	local sample_tracks<const> = program.sample_tracks
	local has_sample_tracks<const> = #sample_tracks > 0
	local has_primary_sample_binding = false
	local has_secondary_sample_binding = false
	local has_pingpong_tracks = false
	local has_sin_tracks = false
	local has_wave_tracks = false
	local has_sample_params = false
	for index = 1, #sample_tracks do
		local track<const> = sample_tracks[index]
		if track.binding_index == 1 then
			has_primary_sample_binding = true
		else
			has_secondary_sample_binding = true
		end
		if track.kind == 'wave' then
			has_wave_tracks = true
			if track.base_param ~= nil then
				has_sample_params = true
			end
			if track.wave == 'pingpong' then
				has_pingpong_tracks = true
			else
				has_sin_tracks = true
			end
		else
			has_sample_params = true
		end
	end
	local factory<const> = compile_syntax(
		track_evaluator_syntax.build({
			has_frame_steps = has_frame_steps,
			has_time_steps = has_time_steps,
			has_scalar_channels = has_scalar_channels,
			has_sample_tracks = has_sample_tracks,
			has_primary_sample_binding = has_primary_sample_binding,
			has_secondary_sample_binding = has_secondary_sample_binding,
			has_wave_tracks = has_wave_tracks,
			has_sample_params = has_sample_params,
			has_pingpong_tracks = has_pingpong_tracks,
			has_sin_tracks = has_sin_tracks,
			sample_flag = sample_flag,
			wrapped_flag = wrapped_flag,
			reset_step_flags = reset_step_flags,
			sample_tracks = sample_tracks,
		}),
		'[timeline.track_values]',
		{
			apply_step_bucket = apply_step_bucket,
			sample_step_tracks = sample_step_tracks,
			sample_time_step_tracks = sample_time_step_tracks,
			sample_tracks = sample_tracks,
			pingpong01 = pingpong01,
			sin = sin,
			tau = tau,
		}
	)()
	return function(tracks)
		local scalar_runner
		if has_scalar_channels then
			scalar_runner = scalar_program.runner_factory(tracks.scalar_channels)
		end
		return factory(tracks, scalar_runner)
	end
end

function track_evaluator.init_entry(entry)
	local tracks<const> = entry.instance.program.tracks
	local steps<const> = tracks.steps
	position_time_step_cursor(entry, steps, entry.instance.position_ms)
	local scalar_channels<const> = tracks.scalar_channels
	local cached_segment_count<const> = scalar_channels.cached_segment_count
	if cached_segment_count == 0 then
		entry.cached_scalar_segments = nil
	else
		local segments = entry.cached_scalar_segments
		if segments == nil then
			segments = {}
			entry.cached_scalar_segments = segments
		end
		local initial_cached_segments<const> = scalar_channels.initial_cached_segments
		for index = 1, cached_segment_count do
			segments[index] = initial_cached_segments[index]
		end
		for index = cached_segment_count + 1, #segments do
			segments[index] = nil
		end
	end

	local tag_count<const> = tracks.tags.tag_count
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
