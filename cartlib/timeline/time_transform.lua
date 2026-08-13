local timeline_evaluation_context<const> = require('cartlib/timeline/evaluation_context')
local timeline_playback<const> = require('cartlib/timeline/playback')
local time_transform_syntax<const> = require('cartlib/timeline/time_transform_syntax')

-- Clip transforms are immutable execution programs selected at sequence
-- admission. Generated datapaths own both time mapping and child transport, so
-- the 50 Hz sequence evaluator only dispatches the retained transform.
local time_transform<const> = {}
local playback<const> = timeline_playback.mode
local playback_once<const> = playback.once
local playback_loop<const> = playback.loop
local playback_pingpong<const> = playback.pingpong
local boundary<const> = timeline_playback.boundary
local boundary_none<const> = boundary.none
local boundary_turn<const> = boundary.turn
local evaluation_flag<const> = timeline_playback.evaluation_flag
local sample_flag<const> = evaluation_flag.sample
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial
local loop_boundary_flags<const> = boundary.loop | wrapped_flag
local play_update_method<const> = timeline_playback.update_method.play
local affine_identity<const> = 0
local affine_translation<const> = 1
local affine_scaled<const> = 2
local shape_continuous<const> = 0x001
local shape_bounded<const> = 0x002
local shape_translation<const> = 0x004
local shape_scaled<const> = 0x008
local shape_backward<const> = 0x010
local shape_position<const> = 0x020
local shape_loop<const> = 0x040
local shape_pingpong<const> = 0x080
local shape_boundary_callback<const> = 0x100
local shape_evaluation_callbacks<const> = 0x200
local shape_active<const> = 0x400
local compile_syntax<const> = lua_compiler.compile_syntax
local compile_environment<const> = {
	write_evaluation_context = timeline_evaluation_context.write,
}
local transform_by_shape<const> = {}

local transform_shape<const> = function(
	playback_mode,
	continuous,
	bounded,
	affine,
	direction,
	has_boundary_callback,
	has_evaluation_callbacks,
	active
)
	local shape = 0
	if continuous then
		shape = shape | shape_continuous
	end
	if bounded then
		shape = shape | shape_bounded
	end
	if affine == affine_translation then
		shape = shape | shape_translation
	elseif affine == affine_scaled then
		shape = shape | shape_scaled
	end
	if direction < 0 then
		shape = shape | shape_backward
	elseif direction == 0 then
		shape = shape | shape_position
	end
	if playback_mode == playback_loop then
		shape = shape | shape_loop
	elseif playback_mode == playback_pingpong then
		shape = shape | shape_pingpong
	end
	if has_boundary_callback then
		shape = shape | shape_boundary_callback
		if has_evaluation_callbacks then
			shape = shape | shape_evaluation_callbacks
		end
	end
	if active then
		shape = shape | shape_active
	end
	return shape
end

local compile_transform<const> = function(
	playback_mode,
	continuous,
	bounded,
	affine,
	direction,
	has_boundary_callback,
	has_evaluation_callbacks,
	active
)
	local shape<const> = transform_shape(
		playback_mode,
		continuous,
		bounded,
		affine,
		direction,
		has_boundary_callback,
		has_evaluation_callbacks,
		active
	)
	local transform<const> = transform_by_shape[shape]
	if transform ~= nil then
		return transform
	end
	local values<const> = {
		continuous = continuous,
		position = direction == 0,
		bounded = bounded,
		affine = affine,
		direction = direction,
		has_boundary_callback = has_boundary_callback,
		has_evaluation_callbacks = has_evaluation_callbacks,
		active = active,
		sample_flag = sample_flag,
		initial_flag = initial_flag,
		play_method = play_update_method,
		boundary_none = boundary_none,
		boundary_turn = boundary_turn,
		loop_boundary_flags = loop_boundary_flags,
	}
	local syntax_tree
	if playback_mode == playback_once then
		syntax_tree = time_transform_syntax.build_once(values)
	elseif playback_mode == playback_loop then
		values.boundary_callback_member = 'on_loop'
		syntax_tree = time_transform_syntax.build_loop(values)
	else
		values.boundary_callback_member = 'on_turn'
		syntax_tree = time_transform_syntax.build_pingpong(values)
	end
	local environment = nil
	if has_boundary_callback and not has_evaluation_callbacks then
		environment = compile_environment
	end
	local compiled<const> = compile_syntax(
		syntax_tree,
		'[timeline.time_transform]',
		environment
	)()
	transform_by_shape[shape] = compiled
	return compiled
end

local classify_affine<const> = function(time_scale, time_offset_ms)
	if time_scale == 1 then
		if time_offset_ms == 0 then
			return affine_identity
		end
		return affine_translation
	end
	return affine_scaled
end

-- Playback direction, affine mapping, bounds, child timing and callback
-- capabilities are authored facts. Active clips also have an established child
-- cursor, so their transform omits admission branches entirely. Runtime
-- instances retain only transport state and the selected dispatch.
function time_transform.compile(
	playback_mode,
	time_scale,
	time_offset_ms,
	clip_in_ms,
	clip_duration_ms,
	child_duration_ms,
	child_duration_stable,
	continuous,
	has_evaluation_callbacks,
	has_loop_callback,
	has_turn_callback
)
	local forward_direction = 1
	local backward_direction = -1
	if time_scale < 0 then
		forward_direction = -1
		backward_direction = 1
	elseif time_scale == 0 then
		backward_direction = 1
	end
	local bounded = false
	if playback_mode == playback_once then
		local child_end_time_ms<const> = clip_in_ms + clip_duration_ms * time_scale
		local in_range<const> = child_duration_stable
		and (child_duration_ms == nil
		or (clip_in_ms >= 0
		and clip_in_ms <= child_duration_ms
		and child_end_time_ms >= 0
		and child_end_time_ms <= child_duration_ms))
		bounded = not in_range
	end
	local has_boundary_callback = false
	if playback_mode == playback_loop then
		has_boundary_callback = has_loop_callback
	elseif playback_mode == playback_pingpong then
		has_boundary_callback = has_turn_callback
	end
	local affine<const> = classify_affine(time_scale, time_offset_ms)
	return compile_transform(
		playback_mode,
		continuous,
		bounded,
		affine,
		forward_direction,
		has_boundary_callback,
		has_evaluation_callbacks,
		false
	), compile_transform(
		playback_mode,
		continuous,
		bounded,
		affine,
		backward_direction,
		has_boundary_callback,
		has_evaluation_callbacks,
		false
	), compile_transform(
		playback_mode,
		continuous,
		bounded,
		affine,
		forward_direction,
		has_boundary_callback,
		has_evaluation_callbacks,
		true
	), compile_transform(
		playback_mode,
		continuous,
		bounded,
		affine,
		backward_direction,
		has_boundary_callback,
		has_evaluation_callbacks,
		true
	), compile_transform(
		playback_mode,
		continuous,
		bounded,
		affine,
		0,
		false,
		false,
		false
	)
end

return time_transform
