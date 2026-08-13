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

-- Monotonic loop playback resumes from the child transport position. Initial
-- admission decodes absolute parent time; positioning remains on the absolute
-- transforms below.
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
	local previous_local_ms
	if initial then
		previous_local_ms = child_time_at(clip, previous_parent_time_ms) % duration_ms
	else
		previous_local_ms = target.instance.position_ms
	end
	local remaining_ms = (parent_time_ms - previous_parent_time_ms) * clip.time_scale
	local evaluated = false
	local distance_ms = duration_ms - previous_local_ms
	while remaining_ms >= distance_ms do
		remaining_ms = remaining_ms - distance_ms
		target.instance.wrapped = true
		write_range(
			target,
			owner,
			previous_local_ms,
			0,
			evaluate,
			1,
			initial,
			loop_boundary_flags
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
		evaluated = true
		previous_local_ms = 0
		distance_ms = duration_ms
	end
	if remaining_ms > 0 or not evaluated then
		write_range(
			target,
			owner,
			previous_local_ms,
			previous_local_ms + remaining_ms,
			evaluate,
			1,
			initial,
			boundary_none
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
	local previous_local_ms
	if initial then
		previous_local_ms = child_time_at(clip, previous_parent_time_ms) % duration_ms
	else
		previous_local_ms = target.instance.position_ms
	end
	local remaining_ms = (previous_parent_time_ms - parent_time_ms) * clip.time_scale
	local evaluated = false
	local distance_ms = previous_local_ms
	while remaining_ms > distance_ms do
		remaining_ms = remaining_ms - distance_ms
		target.instance.wrapped = true
		write_range(
			target,
			owner,
			previous_local_ms,
			duration_ms,
			evaluate,
			-1,
			initial,
			loop_boundary_flags
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
		evaluated = true
		previous_local_ms = duration_ms
		distance_ms = duration_ms
	end
	if remaining_ms > 0 or not evaluated then
		write_range(
			target,
			owner,
			previous_local_ms,
			previous_local_ms - remaining_ms,
			evaluate,
			-1,
			initial,
			boundary_none
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
	-- Both endpoints share the immutable linear transform coefficients, so a
	-- range decodes them once rather than once per endpoint.
	local time_scale<const> = clip.time_scale
	local time_offset_ms<const> = clip.time_offset_ms
	local previous_time_ms<const> = previous_parent_time_ms * time_scale + time_offset_ms
	local time_ms<const> = parent_time_ms * time_scale + time_offset_ms
	local cursor_ms = previous_time_ms
	local segment<const> = cursor_ms // duration_ms
	local segment_start_ms<const> = segment * duration_ms
	local segment_offset_ms<const> = cursor_ms - segment_start_ms
	local previous_local_ms
	local direction
	if segment & 1 == 0 then
		previous_local_ms = segment_offset_ms
		direction = 1
	else
		previous_local_ms = duration_ms - segment_offset_ms
		direction = -1
	end
	local boundary_ms = segment_start_ms + duration_ms
	while boundary_ms <= time_ms do
		local local_time_ms = 0
		if direction > 0 then
			local_time_ms = duration_ms
		end
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_turn
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
		direction = -direction
		boundary_ms = boundary_ms + duration_ms
	end
	if cursor_ms < time_ms or cursor_ms == previous_time_ms then
		write_range(
			target,
			owner,
			previous_local_ms,
			previous_local_ms + (time_ms - cursor_ms) * direction,
			evaluate,
			direction,
			initial,
			boundary_none
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
	local time_scale<const> = clip.time_scale
	local time_offset_ms<const> = clip.time_offset_ms
	local previous_time_ms<const> = previous_parent_time_ms * time_scale + time_offset_ms
	local time_ms<const> = parent_time_ms * time_scale + time_offset_ms
	local cursor_ms = previous_time_ms
	local segment = cursor_ms // duration_ms
	local segment_start_ms = segment * duration_ms
	local segment_offset_ms = cursor_ms - segment_start_ms
	if segment_offset_ms == 0 then
		segment = segment - 1
		segment_start_ms = segment_start_ms - duration_ms
		segment_offset_ms = duration_ms
	end
	local previous_local_ms
	local direction
	if segment & 1 == 0 then
		previous_local_ms = segment_offset_ms
		direction = -1
	else
		previous_local_ms = duration_ms - segment_offset_ms
		direction = 1
	end
	local boundary_ms = segment_start_ms
	while boundary_ms >= time_ms do
		local local_time_ms = 0
		if direction > 0 then
			local_time_ms = duration_ms
		end
		write_range(
			target,
			owner,
			previous_local_ms,
			local_time_ms,
			evaluate,
			direction,
			initial,
			boundary_turn
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
		direction = -direction
		boundary_ms = boundary_ms - duration_ms
	end
	if cursor_ms > time_ms or cursor_ms == previous_time_ms then
		write_range(
			target,
			owner,
			previous_local_ms,
			previous_local_ms + (cursor_ms - time_ms) * direction,
			evaluate,
			direction,
			initial,
			boundary_none
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
		boundary_none
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
		boundary_none
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
		boundary_none
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
	local time_scale<const> = clip.time_scale
	local time_offset_ms<const> = clip.time_offset_ms
	local previous_time_ms<const>, time_ms<const> = bound_once_range(
		target,
		previous_parent_time_ms * time_scale + time_offset_ms,
		parent_time_ms * time_scale + time_offset_ms
	)
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		target.play_evaluator,
		direction_between(previous_time_ms, time_ms, clip.direction),
		initial,
		boundary_none
	)
end

local evaluate_play_once_in_range<const> = function(
	target,
	owner,
	previous_parent_time_ms,
	parent_time_ms,
	initial
)
	local clip<const> = target.clip
	local time_scale<const> = clip.time_scale
	local time_offset_ms<const> = clip.time_offset_ms
	local previous_time_ms<const> = previous_parent_time_ms * time_scale + time_offset_ms
	local time_ms<const> = parent_time_ms * time_scale + time_offset_ms
	target.write_time_range(
		target,
		owner,
		previous_time_ms,
		time_ms,
		target.play_evaluator,
		direction_between(previous_time_ms, time_ms, clip.direction),
		initial,
		boundary_none
	)
end

-- Playback mode is authored configuration, not runtime transport state. Clip
-- admission resolves it and time-scale direction into direct parent-forward
-- and parent-backward datapaths retained by the compiled clip.
function time_transform.compile(
	playback_mode,
	time_scale,
	clip_in_ms,
	clip_duration_ms,
	child_duration_ms,
	child_duration_stable
)
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
	-- A static once clip whose complete authored interval maps inside the child
	-- interval cannot reach a clamp edge during playback. Frame builders retain
	-- the bounded datapath because binding can replace their child duration.
	local child_end_time_ms<const> = clip_in_ms + clip_duration_ms * time_scale
	if child_duration_stable
	and (child_duration_ms == nil
	or (clip_in_ms >= 0
	and clip_in_ms <= child_duration_ms
	and child_end_time_ms >= 0
	and child_end_time_ms <= child_duration_ms)) then
		return evaluate_play_once_in_range, evaluate_play_once_in_range, evaluate_position_once
	end
	return evaluate_play_once, evaluate_play_once, evaluate_position_once
end

return time_transform
