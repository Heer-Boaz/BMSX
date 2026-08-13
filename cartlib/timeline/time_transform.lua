local timeline_evaluation_context<const> = require('cartlib/timeline/evaluation_context')
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
local evaluation_flag<const> = timeline_playback.evaluation_flag
local sample_flag<const> = evaluation_flag.sample
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial
local loop_boundary_flags<const> = boundary_loop | wrapped_flag

-- Time transforms own loop and turn boundaries. Authored boundary callbacks
-- are therefore dispatched here, after the exact monotonic child range which
-- crossed the boundary has been evaluated.
local notify_boundary<const> = function(
	callback,
	target,
	previous_time_ms,
	time_ms,
	direction,
	initial,
	boundary_flags
)
	local instance<const> = target.instance
	local program<const> = instance.program
	local context<const> = target.evaluation_context
	if not program.has_evaluation_callbacks then
		local previous_frame = 0
		local frame = 0
		local sample = true
		if not program.continuous then
			local frame_duration<const> = program.frame_duration
			local last_frame<const> = program.length - 1
			previous_frame = (previous_time_ms / frame_duration) // 1
			if previous_frame > last_frame then
				previous_frame = last_frame
			end
			frame = instance.head
			sample = initial or frame ~= previous_frame
		end
		local flags = boundary_flags
		if sample then
			flags = flags | sample_flag
		end
		if initial then
			flags = flags | initial_flag
		end
		timeline_evaluation_context.write(
			context,
			program,
			play_update_method,
			previous_frame,
			frame,
			previous_time_ms,
			time_ms,
			direction,
			flags
		)
	end
	callback(target.primary_binding, context)
end

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

local direction_between<const> = function(previous_time_ms, time_ms, default_direction)
	if time_ms > previous_time_ms then
		return 1
	end
	if time_ms < previous_time_ms then
		return -1
	end
	return default_direction
end

-- A ping-pong phase is needed only when a range has zero local displacement.
-- Keep that modulus off ordinary monotonic traversal.
local pingpong_direction_between<const> = function(
	previous_time_ms,
	time_ms,
	raw_time_ms,
	duration_ms,
	raw_direction
)
	if time_ms > previous_time_ms then
		return 1
	end
	if time_ms < previous_time_ms then
		return -1
	end
	local phase_ms<const> = raw_time_ms % (duration_ms * 2)
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
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local evaluate<const> = target.play_evaluator
	local write_range<const> = target.write_time_range
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
			evaluate,
			1,
			initial,
			boundary_loop,
			true
		)
		local on_loop<const> = clip.on_loop
		if on_loop ~= nil then
			notify_boundary(
				on_loop,
				target,
				previous_local_ms,
				0,
				1,
				initial,
				loop_boundary_flags
			)
		end
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
			evaluate,
			1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_loop_backward<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local evaluate<const> = target.play_evaluator
	local write_range<const> = target.write_time_range
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
			evaluate,
			-1,
			initial,
			boundary_loop,
			true
		)
		local on_loop<const> = clip.on_loop
		if on_loop ~= nil then
			notify_boundary(
				on_loop,
				target,
				previous_local_ms,
				duration_ms,
				-1,
				initial,
				loop_boundary_flags
			)
		end
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
			evaluate,
			-1,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_forward<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local evaluate<const> = target.play_evaluator
	local write_range<const> = target.write_time_range
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms)
	local time_ms<const> = child_time_at(clip, parent_time_ms)
	local cursor_ms = previous_time_ms
	local previous_local_ms = pingpong_time(cursor_ms, duration_ms)
	local boundary_ms = (cursor_ms // duration_ms + 1) * duration_ms
	while boundary_ms <= time_ms do
		local local_time_ms<const> = pingpong_time(boundary_ms, duration_ms)
		local direction<const> = pingpong_direction_between(
			previous_local_ms,
			local_time_ms,
			boundary_ms,
			duration_ms,
			1
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_turn,
			false
		)
		local on_turn<const> = clip.on_turn
		if on_turn ~= nil then
			notify_boundary(
				on_turn,
				target,
				previous_local_ms,
				local_time_ms,
				direction,
				initial,
				boundary_turn
			)
		end
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = local_time_ms
		boundary_ms = boundary_ms + duration_ms
	end
	if cursor_ms < time_ms or cursor_ms == previous_time_ms then
		local local_time_ms<const> = pingpong_time(time_ms, duration_ms)
		local direction<const> = pingpong_direction_between(
			previous_local_ms,
			local_time_ms,
			time_ms,
			duration_ms,
			1
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_pingpong_backward<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local evaluate<const> = target.play_evaluator
	local write_range<const> = target.write_time_range
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
		local direction<const> = pingpong_direction_between(
			previous_local_ms,
			local_time_ms,
			boundary_ms,
			duration_ms,
			-1
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_turn,
			false
		)
		local on_turn<const> = clip.on_turn
		if on_turn ~= nil then
			notify_boundary(
				on_turn,
				target,
				previous_local_ms,
				local_time_ms,
				direction,
				initial,
				boundary_turn
			)
		end
		initial = false
		cursor_ms = boundary_ms
		previous_local_ms = local_time_ms
		boundary_ms = boundary_ms - duration_ms
	end
	if cursor_ms > time_ms or cursor_ms == previous_time_ms then
		local local_time_ms<const> = pingpong_time(time_ms, duration_ms)
		local direction<const> = pingpong_direction_between(
			previous_local_ms,
			local_time_ms,
			time_ms,
			duration_ms,
			-1
		)
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_none,
			false
		)
	end
end

local evaluate_position_once<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	evaluate,
	initial
)
	local clip<const> = target.clip
	local previous_time_ms<const>, time_ms<const> = bound_once_range(
		target,
		child_time_at(clip, previous_parent_time_ms),
		child_time_at(clip, parent_time_ms)
	)
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		evaluate,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_position_loop<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	evaluate,
	initial
)
	local clip<const> = target.clip
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = child_time_at(clip, previous_parent_time_ms) % duration_ms
	local time_ms<const> = child_time_at(clip, parent_time_ms) % duration_ms
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		evaluate,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_position_pingpong<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	evaluate,
	initial
)
	local clip<const> = target.clip
	local duration_ms<const> = target.duration_ms
	local previous_time_ms<const> = pingpong_time(
		child_time_at(clip, previous_parent_time_ms),
		duration_ms
	)
	local time_ms<const> = pingpong_time(child_time_at(clip, parent_time_ms), duration_ms)
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		evaluate,
		direction_between(previous_time_ms, time_ms, 0),
		initial,
		boundary_none,
		false
	)
end

local evaluate_play_once<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local previous_time_ms<const>, time_ms<const> = bound_once_range(
		target,
		child_time_at(clip, previous_parent_time_ms),
		child_time_at(clip, parent_time_ms)
	)
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		target.play_evaluator,
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
