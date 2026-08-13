local timeline_playback<const> = require('cartlib/timeline/playback')

-- A clip transform is a linear parent-to-child mapping followed by an optional
-- time warp. The evaluator emits monotonic child ranges at every warp boundary
-- so downstream track code never has to infer skipped turns.
local time_transform<const> = {}
local playback_loop<const> = timeline_playback.mode.loop
local playback_pingpong<const> = timeline_playback.mode.pingpong
local play_update_method<const> = timeline_playback.update_method.play
local boundary<const> = timeline_playback.boundary
local boundary_none<const> = boundary.none
local boundary_loop<const> = boundary.loop
local boundary_turn<const> = boundary.turn

local child_time_at<const> = function(clip, parent_time_ms)
	return parent_time_ms * clip.time_scale + clip.time_offset_ms
end

local pingpong_time<const> = function(time_ms, duration_ms)
	local period_ms<const> = duration_ms * 2
	local phase_ms<const> = time_ms % period_ms
	if phase_ms <= duration_ms then
		return phase_ms
	end
	return period_ms - phase_ms
end

local pingpong_direction<const> = function(time_ms, duration_ms, raw_direction)
	local phase_ms<const> = time_ms % (duration_ms * 2)
	if raw_direction > 0 then
		if phase_ms < duration_ms then
			return 1
		end
		return -1
	end
	if phase_ms == 0 or phase_ms > duration_ms then
		return 1
	end
	return -1
end

local direction_between<const> = function(previous_time_ms, time_ms, default_direction)
	if time_ms > previous_time_ms then
		return 1
	end
	if time_ms < previous_time_ms then
		return -1
	end
	return default_direction
end

local bound_once_range<const> = function(target, previous_time_ms, time_ms)
	local duration_ms<const> = target.duration_ms
	if duration_ms == nil then
		return previous_time_ms, time_ms
	end
	if previous_time_ms < 0 then
		previous_time_ms = 0
	elseif previous_time_ms > duration_ms then
		previous_time_ms = duration_ms
	end
	if time_ms < 0 then
		time_ms = 0
	elseif time_ms > duration_ms then
		time_ms = duration_ms
	end
	return previous_time_ms, time_ms
end

local evaluate_loop_forward<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local cursor_ms = previous_time_ms
	local previous_local_ms = cursor_ms % duration_ms
	local boundary_ms = cursor_ms - previous_local_ms + duration_ms
	while boundary_ms <= time_ms do
		write_range(
			target,
			owner,
			previous_local_ms,
			0,
			play_update_method,
			1,
			initial,
			boundary_loop,
			true
		)
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = 0
		boundary_ms = boundary_ms + duration_ms
	end
	if cursor_ms < time_ms or cursor_ms == previous_time_ms then
		write_range(
			target,
			owner,
			previous_local_ms,
			time_ms % duration_ms,
			play_update_method,
			1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_loop_backward<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local cursor_ms = previous_time_ms
	local previous_local_ms = cursor_ms % duration_ms
	local boundary_ms = cursor_ms - previous_local_ms
	while time_ms < boundary_ms do
		write_range(
			target,
			owner,
			previous_local_ms,
			duration_ms,
			play_update_method,
			-1,
			initial,
			boundary_loop,
			true
		)
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = duration_ms
		boundary_ms = boundary_ms - duration_ms
	end
	if cursor_ms > time_ms or cursor_ms == previous_time_ms then
		write_range(
			target,
			owner,
			previous_local_ms,
			time_ms % duration_ms,
			play_update_method,
			-1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_forward<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local cursor_ms = previous_time_ms
	local previous_local_ms = pingpong_time(cursor_ms, duration_ms)
	local boundary_ms = (cursor_ms // duration_ms + 1) * duration_ms
	while boundary_ms <= time_ms do
		local local_time_ms<const> = pingpong_time(boundary_ms, duration_ms)
		local direction<const> = direction_between(
			previous_local_ms,
			local_time_ms,
			pingpong_direction(boundary_ms, duration_ms, 1)
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			play_update_method,
			direction,
			initial,
			boundary_turn,
			false
		)
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = local_time_ms
		boundary_ms = boundary_ms + duration_ms
	end
	if cursor_ms < time_ms or cursor_ms == previous_time_ms then
		local local_time_ms<const> = pingpong_time(time_ms, duration_ms)
		local direction<const> = direction_between(
			previous_local_ms,
			local_time_ms,
			pingpong_direction(time_ms, duration_ms, 1)
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			play_update_method,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_backward<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local cursor_ms = previous_time_ms
	local previous_local_ms = pingpong_time(cursor_ms, duration_ms)
	local remainder_ms<const> = cursor_ms % duration_ms
	local boundary_ms
	if remainder_ms == 0 then
		boundary_ms = cursor_ms - duration_ms
	else
		boundary_ms = cursor_ms - remainder_ms
	end
	while boundary_ms >= time_ms do
		local local_time_ms<const> = pingpong_time(boundary_ms, duration_ms)
		local direction<const> = direction_between(
			previous_local_ms,
			local_time_ms,
			pingpong_direction(boundary_ms, duration_ms, -1)
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			play_update_method,
			direction,
			initial,
			boundary_turn,
			false
		)
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = local_time_ms
		boundary_ms = boundary_ms - duration_ms
	end
	if cursor_ms > time_ms or cursor_ms == previous_time_ms then
		local local_time_ms<const> = pingpong_time(time_ms, duration_ms)
		local direction<const> = direction_between(
			previous_local_ms,
			local_time_ms,
			pingpong_direction(time_ms, duration_ms, -1)
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			play_update_method,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_position_once<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	method,
	initial,
	target,
	owner,
	write_range
)
	local previous_time_ms<const>, time_ms<const> = bound_once_range(
		target,
		child_time_at(clip, previous_parent_time_ms),
		child_time_at(clip, parent_time_ms)
	)
	write_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		method,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_position_loop<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	method,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms) % duration_ms
	local time_ms<const> = child_time_at(clip, parent_time_ms) % duration_ms
	write_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		method,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_position_pingpong<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	method,
	initial,
	target,
	owner,
	write_range
)
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = pingpong_time(
		child_time_at(clip, previous_parent_time_ms),
		duration_ms
	)
	local time_ms<const> = pingpong_time(child_time_at(clip, parent_time_ms), duration_ms)
	write_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		method,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_play_once<const> = function(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	initial,
	target,
	owner,
	write_range
)
	local previous_time_ms<const>, time_ms<const> = bound_once_range(
		target,
		child_time_at(clip, previous_parent_time_ms),
		child_time_at(clip, parent_time_ms)
	)
	write_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		play_update_method,
		direction_between(previous_time_ms, time_ms, clip.direction),
		initial,
		boundary_none,
		false
	)
end

-- Playback mode is authored configuration, not runtime transport state. Clip
-- admission resolves it and time-scale direction into direct parent-forward
-- and parent-backward datapaths retained by the compiled clip.
function time_transform.compile(playback_mode, time_scale)
	if playback_mode == playback_loop then
		if time_scale < 0 then
			return evaluate_loop_backward, evaluate_loop_forward, evaluate_position_loop
		end
		if time_scale == 0 then
			return evaluate_loop_forward, evaluate_loop_forward, evaluate_position_loop
		end
		return evaluate_loop_forward, evaluate_loop_backward, evaluate_position_loop
	end
	if playback_mode == playback_pingpong then
		if time_scale < 0 then
			return evaluate_pingpong_backward, evaluate_pingpong_forward, evaluate_position_pingpong
		end
		if time_scale == 0 then
			return evaluate_pingpong_forward, evaluate_pingpong_forward, evaluate_position_pingpong
		end
		return evaluate_pingpong_forward, evaluate_pingpong_backward, evaluate_position_pingpong
	end
	return evaluate_play_once, evaluate_play_once, evaluate_position_once
end

return time_transform
