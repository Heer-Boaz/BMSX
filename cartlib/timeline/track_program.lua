local easing<const> = require('cartlib/easing')
local timeline_apply<const> = require('cartlib/timeline/apply')

-- Track definitions are classified and specialized once. Runtime evaluation
-- consumes these dense phase programs without inspecting authored track kinds.
local track_program<const> = {}
local empty_defs<const> = {}
local empty_groups<const> = {}
local empty_events<const> = {
	by_frame = {},
	keys = {},
	count = 0,
	time_keys = {},
	time_count = 0,
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
local empty_linear_channels<const> = {
	tracks = {},
	track_count = 0,
	time_tracks = {},
	time_track_count = 0,
}
local empty_prepared<const> = {
	primary_sample_runner = nil,
	sample_groups = empty_groups,
	sample_group_count = 0,
	sample_track_count = 0,
	event_defs = empty_defs,
	tag_defs = empty_defs,
	step_defs = empty_defs,
	linear_defs = empty_defs,
}
track_program.empty = {
	primary_sample_runner = nil,
	sample_groups = empty_groups,
	sample_group_count = 0,
	value_track_count = 0,
	events = empty_events,
	tags = empty_tags,
	steps = empty_steps,
	linear_channels = empty_linear_channels,
}
local sin<const> = math.sin
local pi<const> = math.pi
local event_forward_directions<const> = { forward = true, both = true }
local event_backward_directions<const> = { backward = true, both = true }

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

local combine_sample_runners<const> = function(runners)
	local count<const> = #runners
	if count == 1 then
		return runners[1]
	end
	return function(target, params, evaluation, time_seconds)
		for index = 1, count do
			runners[index](target, params, evaluation, time_seconds)
		end
	end
end

local compile_wave<const> = function(track)
	local base<const> = track.base
	local base_is_param<const> = type(base) == 'string'
	local amp<const> = track.amp
	local phase<const> = track.phase or 0
	local period_inv<const> = 1 / track.period
	local ease<const> = track.ease
	local set_value<const> = timeline_apply.compile_setter(track.path)
	if track.wave == 'pingpong' then
		return function(target, params, _evaluation, time_seconds)
			local wave_value<const> = easing.pingpong01((time_seconds * period_inv) + phase)
			local eased<const> = ease ~= nil and ease(wave_value) or wave_value
			local base_value<const> = base_is_param and params[base] or base
			set_value(target, base_value + ((eased - 0.5) * 2 * amp))
		end
	end
	if track.wave == 'sin' then
		return function(target, params, _evaluation, time_seconds)
			local wave_value<const> = (sin(((time_seconds * period_inv) + phase) * (pi * 2)) + 1) * 0.5
			local eased<const> = ease ~= nil and ease(wave_value) or wave_value
			local base_value<const> = base_is_param and params[base] or base
			set_value(target, base_value + ((eased - 0.5) * 2 * amp))
		end
	end
end

local sampled_track_compilers<const> = {
	wave = compile_wave,
}

-- Value is the authored track role; interpolation selects its compiled
-- evaluator. New interpolation modes therefore do not become parallel public
-- track kinds.
local value_definition_list_by_interpolation<const> = {
	step = 'step_defs',
	linear = 'linear_defs',
}

local add_sample_track<const> = function(groups, track, binding_index_by_id)
	local binding_index = 1
	if track.binding ~= nil then
		binding_index = binding_index_by_id[track.binding]
	end
	local group = groups[#groups]
	if group == nil or group.binding_index ~= binding_index then
		group = { binding_index = binding_index, runners = {} }
		groups[#groups + 1] = group
	end
	local runners<const> = group.runners
	if track.kind == 'sample' then
		runners[#runners + 1] = track.apply
	else
		runners[#runners + 1] = sampled_track_compilers[track.kind](track)
	end
end

local compile_sample_groups<const> = function(source_groups)
	if #source_groups == 0 then
		return nil, empty_groups
	end
	if #source_groups == 1 and source_groups[1].binding_index == 1 then
		return combine_sample_runners(source_groups[1].runners), empty_groups
	end
	local groups<const> = {}
	for index = 1, #source_groups do
		local source<const> = source_groups[index]
		groups[index] = {
			binding_index = source.binding_index,
			runner = combine_sample_runners(source.runners),
		}
	end
	return nil, groups
end

function track_program.prepare(track_defs, binding_index_by_id)
	if #track_defs == 0 then
		return empty_prepared
	end
	local sample_groups<const> = {}
	local event_defs<const> = {}
	local tag_defs<const> = {}
	local step_defs<const> = {}
	local linear_defs<const> = {}
	local prepared<const> = {
		event_defs = event_defs,
		tag_defs = tag_defs,
		step_defs = step_defs,
		linear_defs = linear_defs,
	}
	for index = 1, #track_defs do
		local track<const> = track_defs[index]
		local kind<const> = track.kind
		if kind == 'event' then
			event_defs[#event_defs + 1] = track
		elseif kind == 'tag' then
			tag_defs[#tag_defs + 1] = track
		elseif kind == 'value' then
			local defs<const> = prepared[value_definition_list_by_interpolation[track.interpolation]]
			local binding_index = 1
			if track.binding ~= nil then
				binding_index = binding_index_by_id[track.binding]
			end
			local apply = track.apply
			if apply == nil then
				apply = timeline_apply.compile_setter(track.path)
			end
			defs[#defs + 1] = {
				binding_index = binding_index,
				apply = apply,
				keys = track.keys,
			}
		else
			add_sample_track(sample_groups, track, binding_index_by_id)
		end
	end
	local primary_sample_runner<const>, compiled_sample_groups<const> = compile_sample_groups(sample_groups)
	prepared.primary_sample_runner = primary_sample_runner
	prepared.sample_groups = compiled_sample_groups
	prepared.sample_group_count = #compiled_sample_groups
	prepared.sample_track_count = #track_defs - #event_defs - #tag_defs - #step_defs - #linear_defs
	return prepared
end

local compile_events<const> = function(event_defs, length)
	if #event_defs == 0 then
		return empty_events
	end
	local by_frame<const> = {}
	local keys<const> = {}
	local time_keys<const> = {}
	local order = 0
	for track_index = 1, #event_defs do
		local defs<const> = event_defs[track_index].keys
		for key_index = 1, #defs do
			local key_def<const> = defs[key_index]
			order = order + 1
			local key<const> = {
				event = key_def.event,
				payload = key_def.payload,
				forward = event_forward_directions[key_def.direction],
				backward = event_backward_directions[key_def.direction],
				order = order,
			}
			if key_def.time_ms ~= nil then
				key.time_ms = key_def.time_ms
				time_keys[#time_keys + 1] = key
			else
				key.frame = frame_at(key_def, length)
				keys[#keys + 1] = key
				local bucket = by_frame[key.frame]
				if bucket == nil then
					bucket = {}
					by_frame[key.frame] = bucket
				end
				bucket[#bucket + 1] = key
			end
		end
	end
	table.sort(keys, compare_key)
	table.sort(time_keys, compare_time_key)
	for index = 1, #keys do
		keys[index].order = nil
	end
	for index = 1, #time_keys do
		time_keys[index].order = nil
	end
	return {
		by_frame = by_frame,
		keys = keys,
		count = #keys,
		time_keys = time_keys,
		time_count = #time_keys,
	}
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

local compile_steps<const> = function(step_defs, length)
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
		local track<const> = {
			binding_index = step_def.binding_index,
			apply = step_def.apply,
			keys = keys,
			key_count = #keys,
		}
		if time_domain then
			time_tracks[#time_tracks + 1] = track
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.track = track
				time_keys[#time_keys + 1] = key
			end
		else
			tracks[#tracks + 1] = track
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.track = track
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
	return {
		by_frame = by_frame,
		reverse_by_frame = reverse_by_frame,
		tracks = tracks,
		track_count = #tracks,
		time_keys = time_keys,
		time_key_count = #time_keys,
		time_tracks = time_tracks,
		time_track_count = #time_tracks,
	}
end

local compile_linear_channels<const> = function(linear_defs, length)
	if #linear_defs == 0 then
		return empty_linear_channels
	end
	local tracks<const> = {}
	local time_tracks<const> = {}
	for track_index = 1, #linear_defs do
		local linear_def<const> = linear_defs[track_index]
		local time_domain<const> = linear_def.keys[1].time_ms ~= nil
		local keys<const> = {}
		for key_index = 1, #linear_def.keys do
			local key_def<const> = linear_def.keys[key_index]
			local key<const> = { value = key_def.value, order = key_index }
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
		for key_index = 1, #keys do
			keys[key_index].order = nil
		end
		for key_index = 1, #keys - 1 do
			local key<const> = keys[key_index]
			local next_key<const> = keys[key_index + 1]
			local span
			if time_domain then
				span = next_key.time_ms - key.time_ms
			else
				span = next_key.frame - key.frame
			end
			key.value_delta = next_key.value - key.value
			key.span_inv = 1 / span
		end
		local track<const> = {
			binding_index = linear_def.binding_index,
			apply = linear_def.apply,
			keys = keys,
			key_count = #keys,
		}
		if time_domain then
			time_tracks[#time_tracks + 1] = track
		else
			tracks[#tracks + 1] = track
		end
	end
	return {
		tracks = tracks,
		track_count = #tracks,
		time_tracks = time_tracks,
		time_track_count = #time_tracks,
	}
end

function track_program.compile(prepared, length)
	if prepared == empty_prepared then
		return track_program.empty
	end
	return {
		primary_sample_runner = prepared.primary_sample_runner,
		sample_groups = prepared.sample_groups,
		sample_group_count = prepared.sample_group_count,
		value_track_count = prepared.sample_track_count + #prepared.step_defs + #prepared.linear_defs,
		events = compile_events(prepared.event_defs, length),
		tags = compile_tags(prepared.tag_defs, length),
		steps = compile_steps(prepared.step_defs, length),
		linear_channels = compile_linear_channels(prepared.linear_defs, length),
	}
end

return track_program
