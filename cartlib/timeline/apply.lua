local timeline_apply<const> = {}
local pingpong01<const> = require('bios/easing').pingpong01
local sin<const> = require('bios/math').sin
local pi<const> = require('bios/math').pi

local copy_path<const> = function(path)
	local out<const> = {}
	for i = 1, #path do
		out[i] = path[i]
	end
	return out
end

local append_key_signature<const> = function(parts, key)
	local key_text<const> = tostring(key)
	parts[#parts + 1] = type(key)
	parts[#parts + 1] = ':'
	parts[#parts + 1] = #key_text
	parts[#parts + 1] = ':'
	parts[#parts + 1] = key_text
	parts[#parts + 1] = ';'
end

local collect_frame_shape<const> = function(node, path, ops, parts)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		append_key_signature(parts, key)
		if type(value) == 'table' then
			parts[#parts + 1] = '{'
			collect_frame_shape(value, path, ops, parts)
			parts[#parts + 1] = '}'
		else
			ops[#ops + 1] = copy_path(path)
		end
		path[path_index] = nil
	end
end

local read_path<const> = function(root, path)
	local value = root
	for i = 1, #path do
		value = value[path[i]]
	end
	return value
end

local write_path<const> = function(root, path, value)
	local count<const> = #path
	if count == 1 then
		root[path[1]] = value
	elseif count == 2 then
		root[path[1]][path[2]] = value
	elseif count == 3 then
		root[path[1]][path[2]][path[3]] = value
	else
		local node = root
		for i = 1, count - 1 do
			node = node[path[i]]
		end
		node[path[count]] = value
	end
end

local compile_frame_shape_apply<const> = function(frame, shape_cache)
	local ops<const> = {}
	local parts<const> = {}
	collect_frame_shape(frame, {}, ops, parts)
	local shape_key<const> = table.concat(parts)
	local cached<const> = shape_cache[shape_key]
	if cached ~= nil then
		return cached
	end
	local count<const> = #ops
	local apply_fn<const> = function(target, frame_value)
		for i = 1, count do
			local path<const> = ops[i]
			write_path(target, path, read_path(frame_value, path))
		end
	end
	shape_cache[shape_key] = apply_fn
	return apply_fn
end

function timeline_apply.compile_frames(frames)
	if frames.__timeline_range then
		error('[timeline_apply] apply=true requires table frames, not timeline.range().')
	end
	local compiled<const> = {}
	local cache<const> = {}
	local shape_cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		if type(frame) ~= 'table' then
			error('[timeline_apply] apply=true requires table frames.')
		end
		local apply_fn = cache[frame]
		if apply_fn == nil then
			apply_fn = compile_frame_shape_apply(frame, shape_cache)
			cache[frame] = apply_fn
		end
		compiled[i] = apply_fn
	end
	return compiled
end

local compile_target_setter<const> = function(path)
	local count<const> = #path
	if count == 0 then
		error('[timeline_apply] track path must not be empty.')
	end
	if count == 1 then
		local key1<const> = path[1]
		return function(target, value)
			target[key1] = value
		end
	end
	if count == 2 then
		local key1<const> = path[1]
		local key2<const> = path[2]
		return function(target, value)
			target[key1][key2] = value
		end
	end
	if count == 3 then
		local key1<const> = path[1]
		local key2<const> = path[2]
		local key3<const> = path[3]
		return function(target, value)
			target[key1][key2][key3] = value
		end
	end
	local captured_path<const> = copy_path(path)
	return function(target, value)
		write_path(target, captured_path, value)
	end
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
		error('[timeline_apply] unknown wave "' .. tostring(track.wave) .. '".')
	end
	error('[timeline_apply] unknown track kind "' .. tostring(kind) .. '".')
end

function timeline_apply.compile_tracks(tracks)
	local runners<const> = {}
	for i = 1, #tracks do
		runners[i] = compile_track_runner(tracks[i])
	end
	local count<const> = #runners
	return function(target, params, event)
		local time_seconds<const> = event.time_ms * 0.001
		for i = 1, count do
			runners[i](target, params, event, time_seconds)
		end
	end
end

return timeline_apply
