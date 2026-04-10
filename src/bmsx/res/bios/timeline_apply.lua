local timeline_apply<const> = {}

local render_literal<const> = function(value)
	if value == nil then
		return 'nil'
	end
	local kind<const> = type(value)
	if kind == 'boolean' then
		return value and 'true' or 'false'
	end
	if kind == 'number' then
		if value ~= value or value == math.huge or value == -math.huge then
			error('[timeline_apply] non-finite numeric literals are unsupported.')
		end
		return tostring(value)
	end
	if kind == 'string' then
		return string.format('%q', value)
	end
	error('[timeline_apply] unsupported literal type "' .. kind .. '".')
end

local append_path<const> = function(parts, path, stop)
	if stop == nil then
		stop = #path
	end
	for i = 1, stop do
		parts[#parts + 1] = '['
		parts[#parts + 1] = render_literal(path[i])
		parts[#parts + 1] = ']'
	end
end

local append_frame_assignments<const> = function(parts, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			append_frame_assignments(parts, value, path)
		else
			parts[#parts + 1] = 'target'
			append_path(parts, path)
			parts[#parts + 1] = ' = '
			parts[#parts + 1] = render_literal(value)
			parts[#parts + 1] = '\n'
		end
		path[path_index] = nil
	end
end

local frame_contains_enabled<const> = function(node)
	for key, value in pairs(node) do
		if key == 'enabled' then
			return true
		end
		if type(value) == 'table' and frame_contains_enabled(value) then
			return true
		end
	end
	return false
end

local apply_frame_node<const> = function(target, node)
	for key, value in pairs(node) do
		if type(value) == 'table' then
			apply_frame_node(target[key], value)
		elseif key == 'enabled' then
			target:set_enabled(value)
		else
			target[key] = value
		end
	end
end

local compile_generated_function<const> = function(source, label)
	local loader<const>, err<const> = loadstring(source, label)
	if loader == nil then
		error(err)
	end
	return loader()
end

local compile_frame_apply<const> = function(frame)
	if frame_contains_enabled(frame) then
		return function(target)
			apply_frame_node(target, frame)
		end
	end
	local parts<const> = { 'return function(target)\n' }
	append_frame_assignments(parts, frame, {})
	parts[#parts + 1] = 'end'
	return compile_generated_function(table.concat(parts), '[timeline_apply.frame]')
end

function timeline_apply.compile_frames(frames)
	if frames.__timeline_range then
		error('[timeline_apply] apply=true requires table frames, not timeline.range().')
	end
	local compiled<const> = {}
	local cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		if type(frame) ~= 'table' then
			error('[timeline_apply] apply=true requires table frames.')
		end
		local apply_fn<const> = cache[frame] or compile_frame_apply(frame)
		cache[frame] = apply_fn
		compiled[i] = apply_fn
	end
	return compiled
end

local compile_target_setter<const> = function(path)
	if #path == 0 then
		error('[timeline_apply] track path must not be empty.')
	end
	local parts<const> = { 'return function(target, value)\n', 'target' }
	append_path(parts, path)
	parts[#parts + 1] = ' = value\nend'
	return compile_generated_function(table.concat(parts), '[timeline_apply.setter]')
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
				local w<const> = easing.pingpong01((time_seconds * period_inv) + phase)
				local eased<const> = ease ~= nil and ease(w) or w
				local base_value<const> = base_is_param and params[base] or base
				set_value(target, base_value + ((eased - 0.5) * 2 * amp))
			end
		end
		if track.wave == 'sin' then
			return function(target, params, _event, time_seconds)
				local w<const> = (math.sin(((time_seconds * period_inv) + phase) * (math.pi * 2)) + 1) * 0.5
				local eased<const> = ease ~= nil and ease(w) or w
				local base_value<const> = base_is_param and params[base] or base
				set_value(target, base_value + ((eased - 0.5) * 2 * amp))
			end
		end
		error('[timeline_apply] unknown wave "' .. tostring(track.wave) .. '".')
	end
	if kind == 'sprite_parallax_rig' then
		return function(_target, params, _event, time_seconds)
			set_sprite_parallax_rig(
				params.vy,
				params.scale,
				params.impact,
				time_seconds,
				params.bias_px,
				params.parallax_strength,
				params.scale_strength,
				params.flip_strength,
				params.flip_window
			)
		end
	end
	error('[timeline_apply] unknown track kind "' .. tostring(kind) .. '".')
end

function timeline_apply.compile_tracks(tracks)
	local runners<const> = {}
	for i = 1, #tracks do
		runners[i] = compile_track_runner(tracks[i])
	end
	local count<const> = #runners
	if count == 1 then
		local runner1<const> = runners[1]
		return function(target, params, event)
			runner1(target, params, event, event.time_ms * 0.001)
		end
	end
	if count == 2 then
		local runner1<const> = runners[1]
		local runner2<const> = runners[2]
		return function(target, params, event)
			local time_seconds<const> = event.time_ms * 0.001
			runner1(target, params, event, time_seconds)
			runner2(target, params, event, time_seconds)
		end
	end
	return function(target, params, event)
		local time_seconds<const> = event.time_ms * 0.001
		for i = 1, count do
			runners[i](target, params, event, time_seconds)
		end
	end
end

return timeline_apply
