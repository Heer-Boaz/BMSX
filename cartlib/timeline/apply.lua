local timeline_apply<const> = {}
local pingpong01<const> = require('bios/easing').pingpong01
local sin<const> = require('bios/math').sin
local pi<const> = require('bios/math').pi
local lua_reserved_word<const> = {
	['and'] = true,
	['break'] = true,
	['do'] = true,
	['else'] = true,
	['elseif'] = true,
	['end'] = true,
	['false'] = true,
	['for'] = true,
	['function'] = true,
	['if'] = true,
	['in'] = true,
	['local'] = true,
	['nil'] = true,
	['not'] = true,
	['or'] = true,
	['repeat'] = true,
	['return'] = true,
	['then'] = true,
	['true'] = true,
	['until'] = true,
	['while'] = true,
}

local append_path<const> = function(parts, root, path)
	parts[#parts + 1] = root
	for i = 1, #path do
		local key<const> = path[i]
		if type(key) == 'number' then
			parts[#parts + 1] = '['
			parts[#parts + 1] = key
			parts[#parts + 1] = ']'
		elseif key:match('^[A-Za-z_][A-Za-z0-9_]*$') and not lua_reserved_word[key] then
			parts[#parts + 1] = '.'
			parts[#parts + 1] = key
		else
			parts[#parts + 1] = '['
			parts[#parts + 1] = string.format('%q', key)
			parts[#parts + 1] = ']'
		end
	end
end

local append_frame_shape_assignments<const> = function(parts, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			append_frame_shape_assignments(parts, value, path)
		else
			append_path(parts, 'target', path)
			parts[#parts + 1] = ' = '
			append_path(parts, 'frame', path)
			parts[#parts + 1] = '\n'
		end
		path[path_index] = nil
	end
end

local compile_frame_shape_apply<const> = function(frame, shape_cache)
	local parts<const> = { 'return function(target, frame)\n' }
	append_frame_shape_assignments(parts, frame, {})
	parts[#parts + 1] = 'end'
	local source<const> = table.concat(parts)
	local cached<const> = shape_cache[source]
	if cached ~= nil then
		return cached
	end
	local apply_fn<const> = load(source, '[timeline_apply.frame]', 't')()
	shape_cache[source] = apply_fn
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
	if #path == 0 then
		error('[timeline_apply] track path must not be empty.')
	end
	local parts<const> = { 'return function(target, value)\n' }
	append_path(parts, 'target', path)
	parts[#parts + 1] = ' = value\nend'
	return load(table.concat(parts), '[timeline_apply.setter]', 't')()
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
