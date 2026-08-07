local timelineapply<const> = {}
local pingpong01<const> = require('cartlib/easing').pingpong01
local sin<const> = math.sin
local pi<const> = math.pi

local same_frame_shape
same_frame_shape = function(left, right)
	local key_count = 0
	for key, left_value in pairs(left) do
		local right_value<const> = right[key]
		if right_value == nil then
			return false
		end
		local left_is_table<const> = type(left_value) == 'table'
		if left_is_table ~= (type(right_value) == 'table') then
			return false
		end
		if left_is_table and not same_frame_shape(left_value, right_value) then
			return false
		end
		key_count = key_count + 1
	end
	for _ in pairs(right) do
		key_count = key_count - 1
	end
	return key_count == 0
end

local compile_frame_shape_apply
compile_frame_shape_apply = function(frame)
	local leaf_keys<const> = {}
	local leaf_count = 0
	local branch_keys<const> = {}
	local branch_appliers<const> = {}
	local branch_count = 0
	for key, value in pairs(frame) do
		if type(value) == 'table' then
			branch_count = branch_count + 1
			branch_keys[branch_count] = key
			branch_appliers[branch_count] = compile_frame_shape_apply(value)
		else
			leaf_count = leaf_count + 1
			leaf_keys[leaf_count] = key
		end
	end
	return function(target, frame_value)
		for i = 1, leaf_count do
			local key<const> = leaf_keys[i]
			target[key] = frame_value[key]
		end
		for i = 1, branch_count do
			local key<const> = branch_keys[i]
			branch_appliers[i](target[key], frame_value[key])
		end
	end
end

function timelineapply.compile_frames(frames)
	local frame_appliers<const> = {}
	local applier_by_frame<const> = {}
	local shape_samples<const> = {}
	local shape_appliers<const> = {}
	local shape_count = 0
	for i = 1, #frames do
		local frame<const> = frames[i]
		local apply_frame = applier_by_frame[frame]
		if apply_frame == nil then
			for shape_index = 1, shape_count do
				if same_frame_shape(frame, shape_samples[shape_index]) then
					apply_frame = shape_appliers[shape_index]
					break
				end
			end
			if apply_frame == nil then
				apply_frame = compile_frame_shape_apply(frame)
				shape_count = shape_count + 1
				shape_samples[shape_count] = frame
				shape_appliers[shape_count] = apply_frame
			end
			applier_by_frame[frame] = apply_frame
		end
		frame_appliers[i] = apply_frame
	end
	return frame_appliers
end

local compile_target_setter
compile_target_setter = function(path, index, last_index)
	local key<const> = path[index]
	if index == last_index then
		return function(target, value)
			target[key] = value
		end
	end
	local child<const> = compile_target_setter(path, index + 1, last_index)
	return function(target, value)
		child(target[key], value)
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
		local path<const> = track.path
		local set_value<const> = compile_target_setter(path, 1, #path)
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

function timelineapply.compile_tracks(tracks)
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

return timelineapply
