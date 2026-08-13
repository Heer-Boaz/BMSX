local timeline_playback<const> = require('cartlib/timeline/playback')

-- A clip transform is a linear parent-to-child mapping followed by an optional
-- time warp. The evaluator emits monotonic child ranges at every warp boundary
-- so downstream track code never has to infer skipped turns.
local time_transform<const> = {}
local playback_loop<const> = timeline_playback.mode.loop
local playback_pingpong<const> = timeline_playback.mode.pingpong
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

local warped_time<const> = function(clip, time_ms)
	local mode<const> = clip.playback_mode
	local duration_ms<const> = clip.program.duration_ms
	if mode == playback_loop then
		return time_ms % duration_ms
	end
	if mode == playback_pingpong then
		return pingpong_time(time_ms, duration_ms)
	end
	return time_ms
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

local evaluate_loop_forward<const> = function(
	clip,
	previous_time_ms,
	time_ms,
	method,
	initial,
	target,
	write_range
)
	local duration_ms<const> = clip.program.duration_ms
	local cursor_ms = previous_time_ms
	local previous_local_ms = cursor_ms % duration_ms
	local boundary_ms = cursor_ms - previous_local_ms + duration_ms
	while boundary_ms <= time_ms do
		write_range(
			target,
			previous_local_ms,
			0,
			method,
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
			previous_local_ms,
			time_ms % duration_ms,
			method,
			1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_loop_backward<const> = function(
	clip,
	previous_time_ms,
	time_ms,
	method,
	initial,
	target,
	write_range
)
	local duration_ms<const> = clip.program.duration_ms
	local cursor_ms = previous_time_ms
	local previous_local_ms = cursor_ms % duration_ms
	local boundary_ms = cursor_ms - previous_local_ms
	while time_ms < boundary_ms do
		write_range(
			target,
			previous_local_ms,
			duration_ms,
			method,
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
			previous_local_ms,
			time_ms % duration_ms,
			method,
			-1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_forward<const> = function(
	clip,
	previous_time_ms,
	time_ms,
	method,
	initial,
	target,
	write_range
)
	local duration_ms<const> = clip.program.duration_ms
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
			previous_local_ms,
			local_time_ms,
			method,
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
			previous_local_ms,
			local_time_ms,
			method,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_backward<const> = function(
	clip,
	previous_time_ms,
	time_ms,
	method,
	initial,
	target,
	write_range
)
	local duration_ms<const> = clip.program.duration_ms
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
			previous_local_ms,
			local_time_ms,
			method,
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
			previous_local_ms,
			local_time_ms,
			method,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

function time_transform.evaluate(
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	method,
	traverse,
	initial,
	target,
	write_range
)
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local mode<const> = clip.playback_mode
	if not traverse then
		local previous_local_ms<const> = warped_time(clip, previous_time_ms)
		local local_time_ms<const> = warped_time(clip, time_ms)
		write_range(
			target,
			previous_local_ms,
			local_time_ms,
			method,
			direction_between(previous_local_ms, local_time_ms, 0),
			initial,
			boundary_none,
			false
		)
		return
	end
	if mode == playback_loop then
		if time_ms > previous_time_ms or (time_ms == previous_time_ms and clip.direction > 0) then
			evaluate_loop_forward(clip, previous_time_ms, time_ms, method, initial, target, write_range)
		else
			evaluate_loop_backward(clip, previous_time_ms, time_ms, method, initial, target, write_range)
		end
		return
	end
	if mode == playback_pingpong then
		if time_ms > previous_time_ms or (time_ms == previous_time_ms and clip.direction > 0) then
			evaluate_pingpong_forward(clip, previous_time_ms, time_ms, method, initial, target, write_range)
		else
			evaluate_pingpong_backward(clip, previous_time_ms, time_ms, method, initial, target, write_range)
		end
		return
	end
	write_range(
		target,
		previous_time_ms,
		time_ms,
		method,
		direction_between(previous_time_ms, time_ms, clip.direction),
		initial,
		boundary_none,
		false
	)
end

return time_transform
