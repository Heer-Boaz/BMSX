-- Runtime track evaluation is split into persistent, sampled, and one-shot
-- phases. Compiled programs contain every lookup table used below; no authored
-- track kind or binding name is inspected on the update path.
local timeline_playback<const> = require('cartlib/timeline/playback')

local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local track_evaluator<const> = {}
local play_update_method<const> = timeline_playback.update_method.play
local templates<const> = {}

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

function track_evaluator.bind_events(program)
	local events<const> = program.tracks.events
	local last_frame<const> = program.length - 1
	local duration_ms<const> = program.duration_ms
	return function(owner, evaluation)
		if evaluation.method ~= play_update_method then
			return
		end
		local direction<const> = evaluation.direction
		local lane = events.backward
		if direction > 0 then
			lane = events.forward
		end
		local previous<const> = evaluation.previous_frame
		local current<const> = evaluation.frame
		if evaluation.wrapped then
			if direction > 0 then
				emit_event_range(lane, owner, previous, last_frame, 1, evaluation.initial)
				emit_event_range(lane, owner, 0, current, 1, true)
			else
				emit_event_range(lane, owner, previous, 0, -1, evaluation.initial)
				emit_event_range(lane, owner, last_frame, current, -1, true)
			end
		elseif evaluation.initial then
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
		local previous_time_ms<const> = evaluation.previous_time_ms
		local time_ms<const> = evaluation.time_ms
		if evaluation.wrapped then
			if direction > 0 then
				emit_time_event_range(lane, owner, previous_time_ms, duration_ms, 1, evaluation.initial)
				emit_time_event_range(lane, owner, 0, time_ms, 1, true)
			else
				emit_time_event_range(lane, owner, previous_time_ms, 0, -1, evaluation.initial)
				emit_time_event_range(lane, owner, duration_ms, time_ms, -1, true)
			end
		elseif evaluation.initial then
			emit_time_event_range(lane, owner, previous_time_ms, time_ms, direction, true)
		elseif previous < 0 then
			emit_time_event_range(events.forward, owner, previous_time_ms, time_ms, 1, true)
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

function track_evaluator.bind_tags(program)
	local tags<const> = program.tracks.tags
	local last_frame<const> = program.length - 1
	local duration_ms<const> = program.duration_ms
	return function(entry, owner, evaluation)
		if evaluation.method ~= play_update_method then
			sync_tags(tags, entry, owner, evaluation.frame, evaluation.time_ms)
			return
		end
		local previous<const> = evaluation.previous_frame
		local current<const> = evaluation.frame
		if evaluation.initial then
			sync_tags(tags, entry, owner, previous, evaluation.previous_time_ms)
		end
		if previous ~= current or evaluation.wrapped then
			if evaluation.wrapped then
				if evaluation.direction > 0 then
					apply_tag_range(tags, entry, owner, previous, last_frame, 1, false, true)
					apply_tag_range(tags, entry, owner, 0, current, 1, true, true)
				else
					apply_tag_range(tags, entry, owner, previous, 0, -1, true, true)
					apply_tag_range(tags, entry, owner, last_frame, current, -1, false, false)
				end
			elseif evaluation.direction > 0 and current == previous + 1 then
				apply_tag_bucket(tags, entry, owner, current, 1)
			elseif evaluation.direction < 0 and current == previous - 1 then
				apply_tag_bucket(tags, entry, owner, previous, -1)
			else
				if evaluation.direction > 0 then
					apply_tag_range(tags, entry, owner, previous, current, 1, false, true)
				else
					apply_tag_range(tags, entry, owner, previous, current, -1, true, false)
				end
			end
		end
		if tags.time_boundary_count == 0 then
			return
		end
		local previous_time_ms<const> = evaluation.previous_time_ms
		local time_ms<const> = evaluation.time_ms
		if evaluation.wrapped then
			if evaluation.direction > 0 then
				apply_time_tag_range(tags, entry, owner, previous_time_ms, duration_ms, 1, false, true)
				apply_time_tag_range(tags, entry, owner, 0, time_ms, 1, true, true)
			else
				apply_time_tag_range(tags, entry, owner, previous_time_ms, 0, -1, true, true)
				apply_time_tag_range(tags, entry, owner, duration_ms, time_ms, -1, false, false)
			end
		elseif previous < 0 then
			apply_time_tag_range(tags, entry, owner, previous_time_ms, time_ms, 1, true, true)
		else
			if evaluation.direction > 0 then
				apply_time_tag_range(tags, entry, owner, previous_time_ms, time_ms, 1, false, true)
			elseif evaluation.direction < 0 then
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

local sample_time_step_tracks<const> = function(entry, steps, time_ms, params, evaluation)
	local tracks<const> = steps.time_tracks
	for index = 1, steps.time_track_count do
		local key<const> = last_time_step_key_at(tracks[index], time_ms)
		if key ~= nil then
			key.apply(entry, key.value, params, evaluation)
		end
	end
end

local apply_time_step_range<const> = function(entry, steps, previous_time_ms, time_ms, params, evaluation)
	local keys<const> = steps.time_keys
	local first<const> = first_time_after(keys, steps.time_key_count, previous_time_ms)
	local finish<const> = first_time_after(keys, steps.time_key_count, time_ms) - 1
	for index = first, finish do
		local key<const> = keys[index]
		key.apply(entry, key.value, params, evaluation)
	end
end

local evaluate_frame_steps<const> = function(entry, steps, params, evaluation)
	if evaluation.sample then
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
end

local evaluate_time_steps<const> = function(entry, steps, params, evaluation)
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

local evaluate_sample_groups<const> = function(entry, tracks, params, evaluation, time_seconds)
	local bindings<const> = entry.bindings
	local groups<const> = tracks.sample_groups
	for index = 1, tracks.sample_group_count do
		local group<const> = groups[index]
		group.runner(bindings[group.binding_index], params, evaluation, time_seconds)
	end
end

local emit_track_captures<const> = function(printer, values)
	if values.has_frame_steps or values.has_time_steps then
		printer:emit(templates.steps_capture, values)
	end
	if values.has_scalar_channels then
		printer:emit(templates.scalar_channels_capture, values)
	end
	if values.has_sample_groups then
		printer:emit(templates.sample_program_capture, values)
	end
end

local emit_dependency_captures<const> = function(printer, values)
	if values.has_frame_steps then
		printer:emit(templates.evaluate_frame_steps_capture, values)
	end
	if values.has_time_steps then
		printer:emit(templates.evaluate_time_steps_capture, values)
	end
	if values.has_scalar_channels then
		printer:emit(templates.scalar_runner_factory_capture, values)
	end
	if values.primary_sample_runner ~= nil then
		printer:emit(templates.primary_sample_runner_capture, values)
	elseif values.has_sample_groups then
		printer:emit(templates.evaluate_sample_groups_capture, values)
	end
end

local emit_params_local<const> = function(printer, values)
	if values.has_frame_steps or values.has_time_steps or values.has_sample_tracks then
		printer:emit(templates.params_local, values)
	end
end

local emit_frame_steps<const> = function(printer, values)
	if values.has_frame_steps then
		printer:emit(templates.frame_steps, values)
	end
end

local emit_time_steps<const> = function(printer, values)
	if values.has_time_steps then
		printer:emit(templates.time_steps, values)
	end
end

local emit_scalar_channels<const> = function(printer, values)
	if values.has_scalar_channels then
		printer:emit(templates.scalar_channels, values)
	end
end

local emit_sample_body<const> = function(printer, values)
	if values.primary_sample_runner ~= nil then
		printer:emit(templates.primary_sample, values)
	else
		printer:emit(templates.sample_groups, values)
	end
end

local emit_sample<const> = function(printer, values)
	if values.has_sample_tracks then
		printer:emit(templates.sample, values)
	end
end

templates.steps_capture = lua_source_printer.compile_template(
	'local steps<const> = tracks["steps"]\n'
)

templates.scalar_channels_capture = lua_source_printer.compile_template([[
	local scalar_channels<const> = tracks["scalar_channels"]
	local scalar_runner<const> = scalar_runner_factory(scalar_channels)
]])

templates.sample_program_capture = lua_source_printer.compile_template(
	'local sample_program<const> = tracks\n'
)

templates.evaluate_frame_steps_capture = lua_source_printer.compile_template(
	'local evaluate_frame_steps<const> = evaluate_frame_steps\n'
)

templates.evaluate_time_steps_capture = lua_source_printer.compile_template(
	'local evaluate_time_steps<const> = evaluate_time_steps\n'
)

templates.scalar_runner_factory_capture = lua_source_printer.compile_template(
	'local scalar_runner_factory<const> = scalar_runner_factory\n'
)

templates.primary_sample_runner_capture = lua_source_printer.compile_template(
	'local primary_sample_runner<const> = primary_sample_runner\n'
)

templates.evaluate_sample_groups_capture = lua_source_printer.compile_template(
	'local evaluate_sample_groups<const> = evaluate_sample_groups\n'
)

templates.params_local = lua_source_printer.compile_template(
	'local params = entry["params"]\n'
)

templates.frame_steps = lua_source_printer.compile_template(
	'evaluate_frame_steps(entry, steps, params, evaluation)\n'
)

templates.time_steps = lua_source_printer.compile_template(
	'evaluate_time_steps(entry, steps, params, evaluation)\n'
)

templates.scalar_channels = lua_source_printer.compile_template(
	'scalar_runner(entry, evaluation)\n'
)

templates.primary_sample = lua_source_printer.compile_template(
	'primary_sample_runner(entry["primary_binding"], params, evaluation, time_seconds)\n'
)

templates.sample_groups = lua_source_printer.compile_template(
	'evaluate_sample_groups(entry, sample_program, params, evaluation, time_seconds)\n'
)

templates.sample = lua_source_printer.compile_template([[
	if evaluation["sample"] then
		local time_seconds = evaluation["time_ms"] * 0.001
		$body$
	end
]], { body = emit_sample_body })

templates.value_runner = lua_source_printer.compile_template([[
	$dependency_captures$
	return function(tracks)
		$track_captures$
		return function(entry, evaluation)
			$params_local$
			$frame_steps$
			$time_steps$
			$scalar_channels$
			$sample$
		end
	end
]], {
	dependency_captures = emit_dependency_captures,
	track_captures = emit_track_captures,
	params_local = emit_params_local,
	frame_steps = emit_frame_steps,
	time_steps = emit_time_steps,
	scalar_channels = emit_scalar_channels,
	sample = emit_sample,
})

function track_evaluator.compile_values(program)
	local has_frame_steps<const> = program.has_frame_steps
	local has_time_steps<const> = program.has_time_steps
	local scalar_program<const> = program.scalar_program
	local has_scalar_channels<const> = scalar_program.track_count > 0
	local primary_sample_runner<const> = program.primary_sample_runner
	local has_sample_groups<const> = program.sample_group_count > 0
	local has_sample_tracks<const> = primary_sample_runner ~= nil or has_sample_groups
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.value_runner, {
		has_frame_steps = has_frame_steps,
		has_time_steps = has_time_steps,
		has_scalar_channels = has_scalar_channels,
		has_sample_groups = has_sample_groups,
		has_sample_tracks = has_sample_tracks,
		primary_sample_runner = primary_sample_runner,
	})
	return load(
		printer:finish(),
		'[timeline.track_values]',
		't',
		{
			evaluate_frame_steps = evaluate_frame_steps,
			evaluate_time_steps = evaluate_time_steps,
			scalar_runner_factory = scalar_program.runner_factory,
			primary_sample_runner = primary_sample_runner,
			evaluate_sample_groups = evaluate_sample_groups,
		}
	)()
end

function track_evaluator.init_entry(entry)
	local tracks<const> = entry.instance.program.tracks
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
