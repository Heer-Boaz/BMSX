local timeline_apply<const> = require('cartlib/timeline/apply')
local timeline_playback<const> = require('cartlib/timeline/playback')
local scalar_channel<const> = require('cartlib/timeline/scalar_channel')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')

-- Track definitions are classified and specialized once. Runtime evaluation
-- consumes these dense phase programs without inspecting authored track kinds.
-- Sample and wave definitions are fully lowered into their value-runner factory
-- and are not retained in the length-dependent track program.
local track_program<const> = {}
local empty_defs<const> = {}
local empty_event_lane<const> = {
	by_frame = {},
	keys = {},
	count = 0,
	time_keys = {},
	time_count = 0,
}
local empty_directional_events<const> = {
	forward = empty_event_lane,
	backward = empty_event_lane,
}
local empty_events<const> = {
	empty_directional_events,
	empty_directional_events,
	empty_directional_events,
}
local empty_tags<const> = {
	intervals = {},
	interval_count = 0,
	boundaries = {},
	boundary_count = 0,
	boundaries_by_frame = {},
	time_intervals = {},
	time_interval_count = 0,
	time_boundaries = {},
	time_boundary_count = 0,
	tags = {},
	tag_count = 0,
}
local empty_steps<const> = {
	by_frame = {},
	reverse_by_frame = {},
	tracks = {},
	track_count = 0,
	time_keys = {},
	time_key_count = 0,
	time_tracks = {},
	time_track_count = 0,
}
local empty_prepared<const> = {
	sample_track_count = 0,
	value_track_count = 0,
	value_runner_factory = nil,
	has_frame_steps = false,
	has_time_steps = false,
	has_seek_events = false,
	has_scrub_events = false,
	has_evaluation_callbacks = false,
	event_defs = empty_defs,
	tag_defs = empty_defs,
	step_defs = empty_defs,
	scalar_program = scalar_channel.empty_program,
}
track_program.empty = {
	value_track_count = 0,
	play_value_runner = nil,
	position_value_runner = nil,
	events = empty_events,
	tags = empty_tags,
	steps = empty_steps,
	scalar_channels = scalar_channel.empty,
}
local event_forward_directions<const> = { forward = true, both = true }
local event_backward_directions<const> = { backward = true, both = true }
local update_method<const> = timeline_playback.update_method
local play_event_index<const> = update_method.play + 1
local seek_event_index<const> = update_method.jump + 1
local scrub_event_index<const> = update_method.scrub + 1

local compare_key<const> = function(left, right)
	if left.frame == right.frame then
		return left.order < right.order
	end
	return left.frame < right.frame
end

local compare_time_key<const> = function(left, right)
	if left.time_ms == right.time_ms then
		return left.order < right.order
	end
	return left.time_ms < right.time_ms
end

local compare_boundary<const> = function(left, right)
	if left.frame == right.frame then
		if left.delta == right.delta then
			return left.order < right.order
		end
		return left.delta > right.delta
	end
	return left.frame < right.frame
end

local compare_time_boundary<const> = function(left, right)
	if left.time_ms == right.time_ms then
		if left.delta == right.delta then
			return left.order < right.order
		end
		return left.delta > right.delta
	end
	return left.time_ms < right.time_ms
end

local frame_at<const> = function(position, length)
	if position.frame ~= nil then
		return position.frame
	end
	return (position.u * (length - 1)) // 1
end

local compile_sample_track<const> = function(track, binding_index_by_id)
	local binding_index = 1
	if track.binding ~= nil then
		binding_index = binding_index_by_id[track.binding]
	end
	if track.kind == 'sample' then
		return {
			kind = 'sample',
			binding_index = binding_index,
			apply = track.apply,
		}
	end
	local base = track.base
	local base_param
	if type(base) == 'string' then
		base_param = base
		base = nil
	end
	return {
		kind = 'wave',
		binding_index = binding_index,
		path = track.path,
		base = base,
		base_param = base_param,
		amp = track.amp,
		phase = track.phase or 0,
		period_inv = 1 / track.period,
		wave = track.wave,
		ease = track.ease,
	}
end

function track_program.prepare(track_defs, binding_index_by_id)
	if #track_defs == 0 then
		return empty_prepared
	end
	local sample_tracks<const> = {}
	local event_defs<const> = {}
	local tag_defs<const> = {}
	local step_defs<const> = {}
	local scalar_defs<const> = {}
	local has_frame_steps = false
	local has_time_steps = false
	local has_seek_events = false
	local has_scrub_events = false
	local has_evaluation_callbacks = false
	local prepared<const> = {
		event_defs = event_defs,
		tag_defs = tag_defs,
		step_defs = step_defs,
	}
	for index = 1, #track_defs do
		local track<const> = track_defs[index]
		local kind<const> = track.kind
		if kind == 'event' then
			event_defs[#event_defs + 1] = track
			if track.fire_on_seek then
				has_seek_events = true
			end
			if track.fire_on_scrub then
				has_scrub_events = true
			end
		elseif kind == 'tag' then
			tag_defs[#tag_defs + 1] = track
		elseif kind == 'value' then
			local interpolation<const> = track.interpolation
			local binding_index = 1
			if track.binding ~= nil then
				binding_index = binding_index_by_id[track.binding]
			end
			if interpolation == 'step' then
				if track.apply ~= nil then
					has_evaluation_callbacks = true
				end
				step_defs[#step_defs + 1] = {
					apply = timeline_apply.compile_step_apply(track.path, track.apply, binding_index),
					keys = track.keys,
				}
				if track.keys[1].time_ms ~= nil then
					has_time_steps = true
				else
					has_frame_steps = true
				end
			else
				if track.apply ~= nil then
					has_evaluation_callbacks = true
				end
				scalar_defs[#scalar_defs + 1] = {
					binding_index = binding_index,
					apply = track.apply,
					path = track.path,
					interpolation = interpolation,
					keys = track.keys,
				}
			end
		else
			if kind == 'sample' then
				has_evaluation_callbacks = true
			end
			sample_tracks[#sample_tracks + 1] = compile_sample_track(track, binding_index_by_id)
		end
	end
	prepared.sample_track_count = #track_defs - #event_defs - #tag_defs - #step_defs - #scalar_defs
	prepared.value_track_count = prepared.sample_track_count + #step_defs + #scalar_defs
	prepared.has_frame_steps = has_frame_steps
	prepared.has_time_steps = has_time_steps
	prepared.has_seek_events = has_seek_events
	prepared.has_scrub_events = has_scrub_events
	prepared.has_evaluation_callbacks = has_evaluation_callbacks
	prepared.scalar_program = scalar_channel.prepare(scalar_defs)
	if prepared.value_track_count > 0 then
		prepared.value_runner_factory = timeline_track_evaluator.compile_values(prepared, sample_tracks)
	end
	return prepared
end

-- Event direction and update policy are cooked into separate traversal lanes.
-- Play always admits authored events; `fire_on_seek` and `fire_on_scrub` opt a
-- track into swept one-shot dispatch while positioning. A `both` key shares one
-- immutable record between lane indexes, so runtime never filters authored keys.
local new_directional_events<const> = function()
	return {
		forward = { by_frame = {}, keys = {}, time_keys = {} },
		backward = { by_frame = {}, keys = {}, time_keys = {} },
	}
end

local add_event_key<const> = function(events, key, admits_forward, admits_backward)
	if key.time_ms ~= nil then
		if admits_forward then
			events.forward.time_keys[#events.forward.time_keys + 1] = key
		end
		if admits_backward then
			events.backward.time_keys[#events.backward.time_keys + 1] = key
		end
		return
	end
	if admits_forward then
		local lane<const> = events.forward
		lane.keys[#lane.keys + 1] = key
		local bucket = lane.by_frame[key.frame]
		if bucket == nil then
			bucket = {}
			lane.by_frame[key.frame] = bucket
		end
		bucket[#bucket + 1] = key
	end
	if admits_backward then
		local lane<const> = events.backward
		lane.keys[#lane.keys + 1] = key
		local bucket = lane.by_frame[key.frame]
		if bucket == nil then
			bucket = {}
			lane.by_frame[key.frame] = bucket
		end
		bucket[#bucket + 1] = key
	end
end

local finalize_directional_events<const> = function(events)
	local forward<const> = events.forward
	local backward<const> = events.backward
	table.sort(forward.keys, compare_key)
	table.sort(backward.keys, compare_key)
	table.sort(forward.time_keys, compare_time_key)
	table.sort(backward.time_keys, compare_time_key)
	forward.count = #forward.keys
	forward.time_count = #forward.time_keys
	backward.count = #backward.keys
	backward.time_count = #backward.time_keys
end

local compile_events<const> = function(prepared, length)
	local event_defs<const> = prepared.event_defs
	if #event_defs == 0 then
		return empty_events
	end
	local events<const> = {
		new_directional_events(),
		prepared.has_seek_events and new_directional_events() or empty_directional_events,
		prepared.has_scrub_events and new_directional_events() or empty_directional_events,
	}
	local order = 0
	for track_index = 1, #event_defs do
		local track<const> = event_defs[track_index]
		local defs<const> = track.keys
		for key_index = 1, #defs do
			local key_def<const> = defs[key_index]
			order = order + 1
			local key<const> = {
				event = key_def.event,
				payload = key_def.payload,
				order = order,
			}
			local admits_forward<const> = event_forward_directions[key_def.direction]
			local admits_backward<const> = event_backward_directions[key_def.direction]
			if key_def.time_ms ~= nil then
				key.time_ms = key_def.time_ms
			else
				key.frame = frame_at(key_def, length)
			end
			add_event_key(events[play_event_index], key, admits_forward, admits_backward)
			if track.fire_on_seek then
				add_event_key(events[seek_event_index], key, admits_forward, admits_backward)
			end
			if track.fire_on_scrub then
				add_event_key(events[scrub_event_index], key, admits_forward, admits_backward)
			end
		end
	end
	finalize_directional_events(events[play_event_index])
	if prepared.has_seek_events then
		finalize_directional_events(events[seek_event_index])
	end
	if prepared.has_scrub_events then
		finalize_directional_events(events[scrub_event_index])
	end
	local play_events<const> = events[play_event_index]
	local forward_keys<const> = play_events.forward.keys
	for index = 1, #forward_keys do
		forward_keys[index].order = nil
	end
	local backward_keys<const> = play_events.backward.keys
	for index = 1, #backward_keys do
		backward_keys[index].order = nil
	end
	return events
end

local compile_tags<const> = function(tag_defs, length)
	if #tag_defs == 0 then
		return empty_tags
	end
	local intervals<const> = {}
	local boundaries<const> = {}
	local boundaries_by_frame<const> = {}
	local time_intervals<const> = {}
	local time_boundaries<const> = {}
	local tags<const> = {}
	local tag_index_by_name<const> = {}
	for index = 1, #tag_defs do
		local tag_def<const> = tag_defs[index]
		local tag<const> = tag_def.tag
		local tag_index = tag_index_by_name[tag]
		if tag_index == nil then
			tag_index = #tags + 1
			tags[tag_index] = tag
			tag_index_by_name[tag] = tag_index
		end
		local interval<const> = {
			start_event = 'timeline.tag.' .. tag_def.name .. '.start',
			end_event = 'timeline.tag.' .. tag_def.name .. '.end',
			tag_index = tag_index,
			start_payload = tag_def.start_payload,
			end_payload = tag_def.end_payload,
		}
		if tag_def.start.time_ms ~= nil then
			interval.start_time_ms = tag_def.start.time_ms
			interval.end_time_ms = tag_def['end'].time_ms
			time_intervals[#time_intervals + 1] = interval
			time_boundaries[#time_boundaries + 1] = {
				time_ms = interval.start_time_ms,
				delta = 1,
				interval = interval,
				order = index,
			}
			time_boundaries[#time_boundaries + 1] = {
				time_ms = interval.end_time_ms,
				delta = -1,
				interval = interval,
				order = index,
			}
		else
			interval.start_frame = frame_at(tag_def.start, length)
			interval.end_frame = frame_at(tag_def['end'], length)
			intervals[#intervals + 1] = interval
			local start_boundary<const> = {
				frame = interval.start_frame,
				delta = 1,
				interval = interval,
				order = index,
			}
			local end_boundary<const> = {
				frame = interval.end_frame,
				delta = -1,
				interval = interval,
				order = index,
			}
			boundaries[#boundaries + 1] = start_boundary
			boundaries[#boundaries + 1] = end_boundary
			local start_bucket = boundaries_by_frame[start_boundary.frame]
			if start_bucket == nil then
				start_bucket = {}
				boundaries_by_frame[start_boundary.frame] = start_bucket
			end
			start_bucket[#start_bucket + 1] = start_boundary
			local end_bucket = boundaries_by_frame[end_boundary.frame]
			if end_bucket == nil then
				end_bucket = {}
				boundaries_by_frame[end_boundary.frame] = end_bucket
			end
			end_bucket[#end_bucket + 1] = end_boundary
		end
	end
	table.sort(boundaries, compare_boundary)
	table.sort(time_boundaries, compare_time_boundary)
	for _, bucket in pairs(boundaries_by_frame) do
		table.sort(bucket, compare_boundary)
	end
	for index = 1, #boundaries do
		boundaries[index].order = nil
	end
	for index = 1, #time_boundaries do
		time_boundaries[index].order = nil
	end
	return {
		intervals = intervals,
		interval_count = #intervals,
		boundaries = boundaries,
		boundary_count = #boundaries,
		boundaries_by_frame = boundaries_by_frame,
		time_intervals = time_intervals,
		time_interval_count = #time_intervals,
		time_boundaries = time_boundaries,
		time_boundary_count = #time_boundaries,
		tags = tags,
		tag_count = #tags,
	}
end

local compile_time_boundary_state<const> = function(time_tracks, time_keys, time_ms)
	local active_keys<const> = {}
	for track_index = 1, #time_tracks do
		local keys<const> = time_tracks[track_index].keys
		local active_key
		for key_index = 1, #keys do
			local key<const> = keys[key_index]
			if key.time_ms <= time_ms then
				active_key = key
			else
				break
			end
		end
		if active_key ~= nil then
			active_keys[#active_keys + 1] = active_key
		end
	end

	local next_index = 1
	while next_index <= #time_keys and time_keys[next_index].time_ms <= time_ms do
		next_index = next_index + 1
	end
	return {
		keys = active_keys,
		key_count = #active_keys,
		previous_time_key = time_keys[next_index - 1],
		next_time_key = time_keys[next_index],
	}
end

local compile_steps<const> = function(step_defs, length, duration_ms)
	if #step_defs == 0 then
		return empty_steps
	end
	local by_frame<const> = {}
	local reverse_by_frame<const> = {}
	local tracks<const> = {}
	local time_keys<const> = {}
	local time_tracks<const> = {}
	local order = 0
	for track_index = 1, #step_defs do
		local step_def<const> = step_defs[track_index]
		local time_domain<const> = step_def.keys[1].time_ms ~= nil
		local keys<const> = {}
		for key_index = 1, #step_def.keys do
			local key_def<const> = step_def.keys[key_index]
			order = order + 1
			local key<const> = {
				value = key_def.value,
				order = order,
			}
			if time_domain then
				key.time_ms = key_def.time_ms
			else
				key.frame = frame_at(key_def, length)
			end
			keys[key_index] = key
		end
		if time_domain then
			table.sort(keys, compare_time_key)
		else
			table.sort(keys, compare_key)
		end
		local track<const> = { keys = keys, key_count = #keys }
		if time_domain then
			time_tracks[#time_tracks + 1] = track
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.apply = step_def.apply
				key.previous_key = keys[key_index - 1]
				time_keys[#time_keys + 1] = key
			end
		else
			tracks[#tracks + 1] = track
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.apply = step_def.apply
				local bucket = by_frame[key.frame]
				if bucket == nil then
					bucket = {}
					by_frame[key.frame] = bucket
				end
				bucket[#bucket + 1] = key
				if key_index > 1 then
					local reverse_bucket = reverse_by_frame[key.frame]
					if reverse_bucket == nil then
						reverse_bucket = {}
						reverse_by_frame[key.frame] = reverse_bucket
					end
					reverse_bucket[#reverse_bucket + 1] = keys[key_index - 1]
				end
			end
		end
	end
	table.sort(time_keys, compare_time_key)
	for index = 1, #time_keys do
		local key<const> = time_keys[index]
		key.previous_time_key = time_keys[index - 1]
		key.next_time_key = time_keys[index + 1]
	end
	for index = 1, #tracks do
		local keys<const> = tracks[index].keys
		for key_index = 1, #keys do
			keys[key_index].order = nil
		end
	end
	for index = 1, #time_tracks do
		local keys<const> = time_tracks[index].keys
		for key_index = 1, #keys do
			keys[key_index].order = nil
		end
	end
	local start_time_step_state
	local end_time_step_state
	if #time_tracks > 0 then
		start_time_step_state = compile_time_boundary_state(time_tracks, time_keys, 0)
		if duration_ms ~= nil then
			end_time_step_state = compile_time_boundary_state(time_tracks, time_keys, duration_ms)
		end
	end
	return {
		by_frame = by_frame,
		reverse_by_frame = reverse_by_frame,
		tracks = tracks,
		track_count = #tracks,
		time_keys = time_keys,
		time_key_count = #time_keys,
		time_tracks = time_tracks,
		time_track_count = #time_tracks,
		start_time_step_state = start_time_step_state,
		end_time_step_state = end_time_step_state,
	}
end

function track_program.compile(prepared, length, duration_ms)
	if prepared == empty_prepared then
		return track_program.empty
	end
	local scalar_channels<const> = scalar_channel.compile(prepared.scalar_program, length)
	local tracks<const> = {
		value_track_count = prepared.value_track_count,
		play_value_runner = nil,
		position_value_runner = nil,
		events = compile_events(prepared, length),
		tags = compile_tags(prepared.tag_defs, length),
		steps = compile_steps(prepared.step_defs, length, duration_ms),
		scalar_channels = scalar_channels,
	}
	if prepared.value_track_count > 0 then
		tracks.play_value_runner, tracks.position_value_runner = prepared.value_runner_factory(tracks)
	end
	return tracks
end

return track_program
