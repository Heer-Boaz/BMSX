local timeline_apply<const> = {}
local pingpong01<const> = require('cartlib/easing').pingpong01
local sin<const> = math.sin
local pi<const> = math.pi
local format<const> = string.format

local append_path<const> = function(parts, root, path)
	parts[#parts + 1] = root
	for index = 1, #path do
		local key<const> = path[index]
		parts[#parts + 1] = '['
		parts[#parts + 1] = type(key) == 'number' and key or format('%q', key)
		parts[#parts + 1] = ']'
	end
end

local append_frame_assignments
append_frame_assignments = function(parts, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			append_frame_assignments(parts, value, path)
		else
			append_path(parts, 'target', path)
			parts[#parts + 1] = ' = '
			append_path(parts, 'frame', path)
			parts[#parts + 1] = '\n'
		end
		path[path_index] = nil
	end
end

local compile_frame_apply<const> = function(frame, shape_cache)
	local parts<const> = { 'return function(target, frame)\n' }
	append_frame_assignments(parts, frame, {})
	parts[#parts + 1] = 'end'
	local source<const> = table.concat(parts)
	local apply_frame = shape_cache[source]
	if apply_frame == nil then
		apply_frame = load(source, '[timeline.apply.frame]', 't')()
		shape_cache[source] = apply_frame
	end
	return apply_frame
end

function timeline_apply.compile_frames(frames)
	local frame_appliers<const> = {}
	local applier_by_frame<const> = {}
	local shape_cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		local apply_frame = applier_by_frame[frame]
		if apply_frame == nil then
			apply_frame = compile_frame_apply(frame, shape_cache)
			applier_by_frame[frame] = apply_frame
		end
		frame_appliers[i] = apply_frame
	end
	return frame_appliers
end

local compile_target_setter<const> = function(path)
	local parts<const> = { 'return function(target, value)\n' }
	append_path(parts, 'target', path)
	parts[#parts + 1] = ' = value\nend'
	return load(table.concat(parts), '[timeline.apply.setter]', 't')()
end

local compile_track_runner<const> = function(track)
	if type(track) == 'function' then
		return track
	end
	local kind<const> = track.kind
	if kind == 'wave' then
		local base<const> = track.base
		local base_is_param<const> = type(base) == 'string'
		local amp<const> = track.amp
		local phase<const> = track.phase or 0
		local period_inv<const> = 1 / track.period
		local ease<const> = track.ease
		local set_value<const> = compile_target_setter(track.path)
		if track.wave == 'pingpong' then
			return function(target, params, _event, time_seconds)
				local w<const> = pingpong01((time_seconds * period_inv) + phase)
				local eased<const> = ease ~= nil and ease(w) or w
				local base_value<const> = base_is_param and params[base] or base
				set_value(target, base_value + ((eased - 0.5) * 2 * amp))
			end
		end
		if track.wave == 'sin' then
			return function(target, params, _event, time_seconds)
				local w<const> = (sin(((time_seconds * period_inv) + phase) * (pi * 2)) + 1) * 0.5
				local eased<const> = ease ~= nil and ease(w) or w
				local base_value<const> = base_is_param and params[base] or base
				set_value(target, base_value + ((eased - 0.5) * 2 * amp))
			end
		end
	end
end

local combine_track_runners<const> = function(runners)
	local count<const> = #runners
	if count == 1 then
		return runners[1]
	end
	return function(target, params, event, time_seconds)
		for index = 1, count do
			runners[index](target, params, event, time_seconds)
		end
	end
end

function timeline_apply.compile_track_program(tracks, binding_index_by_id)
	if #tracks == 1 then
		local track<const> = tracks[1]
		local binding_index = 1
		if type(track) ~= 'function' and track.binding ~= nil then
			binding_index = binding_index_by_id[track.binding]
		end
		local runner<const> = compile_track_runner(track)
		if binding_index == 1 then
			return runner, nil
		end
		return nil, { { binding_index = binding_index, runner = runner } }
	end
	local source_groups<const> = {}
	for index = 1, #tracks do
		local track<const> = tracks[index]
		local binding_index = 1
		if type(track) ~= 'function' and track.binding ~= nil then
			binding_index = binding_index_by_id[track.binding]
		end
		local group = source_groups[#source_groups]
		if group == nil or group.binding_index ~= binding_index then
			group = { binding_index = binding_index, runners = {} }
			source_groups[#source_groups + 1] = group
		end
		local runners<const> = group.runners
		runners[#runners + 1] = compile_track_runner(track)
	end
	local groups<const> = {}
	for index = 1, #source_groups do
		local source<const> = source_groups[index]
		groups[index] = {
			binding_index = source.binding_index,
			runner = combine_track_runners(source.runners),
		}
	end
	return nil, groups
end

return timeline_apply
