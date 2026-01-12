local stagger = {}

local STAGGER_TIMELINE_PREFIX = 'p3.stagger.'

local presets = {
	calm = {
		offset = 0.15,
		bg_duration = 0.18,
		pose_duration = 0.2,
		text_duration = 0.18,
		bg_alpha = 0.75,
		pose_from = 0.98,
		pose_to = 1.0,
		pose_text_nudge = 1,
		bg_ease = 'quad',
		pose_ease = 'quad',
		text_ease = 'quad',
	},
	combat = {
		offset = 0.2,
		bg_duration = 0.16,
		pose_duration = 0.2,
		text_duration = 0.16,
		bg_alpha = 0.78,
		pose_from = 0.985,
		pose_to = 1.0,
		pose_text_nudge = 2,
		bg_ease = 'quad',
		pose_ease = 'quart',
		text_ease = 'quad',
	},
	urgent = {
		offset = 0.1,
		bg_duration = 0.12,
		pose_duration = 0.18,
		text_duration = 0.14,
		bg_alpha = 0.7,
		pose_from = 0.97,
		pose_to = 1.0,
		pose_text_nudge = 2,
		bg_ease = 'quad',
		pose_ease = 'back',
		text_ease = 'quad',
	},
}

local function clamp01(value)
	if value < 0 then
		return 0
	end
	if value > 1 then
		return 1
	end
	return value
end

local function ease_out_quart(u)
	local x = 1 - u
	return 1 - (x * x * x * x)
end

local function resolve_ease(kind)
	if kind == 'quad' then
		return easing.ease_out_quad
	end
	if kind == 'back' then
		return easing.ease_out_back
	end
	if kind == 'quart' then
		return ease_out_quart
	end
	return easing.smoothstep
end

local function tween_u(time, start_time, duration, ease)
	local u = (time - start_time) / duration
	u = clamp01(u)
	return ease(u)
end

local function apply_text_alpha(text_obj, alpha)
	local color = text_obj.text_color
	color.a = alpha
end

local function apply_bg_alpha(bg, base, alpha)
	local color = bg.sprite_component.colorize
	color.r = base.r
	color.g = base.g
	color.b = base.b
	color.a = alpha
end

local function apply_pose(entry, scale, nudge)
	local obj = entry.obj
	local sc = obj.sprite_component
	local target = sc.scale
	target.x = entry.base_scale_x * scale
	target.y = entry.base_scale_y * scale
	obj.y = entry.base_y + nudge
end

local function stagger_track(target, params, event)
	local cfg = params.cfg
	local t = event.time_seconds
	local bg = params.bg
	local text_main = params.text_main
	local text_choice = params.text_choice
	local text_prompt = params.text_prompt
	local bg_ease = params.bg_ease
	local pose_ease = params.pose_ease
	local text_ease = params.text_ease
	local text_active = text_main ~= nil and text_main.is_typing == true

	target.stagger_blocked = t < cfg.text_start

	if bg then
		local u = tween_u(t, cfg.bg_start, cfg.bg_duration, bg_ease)
		local alpha = cfg.bg_from + ((cfg.bg_to - cfg.bg_from) * u)
		apply_bg_alpha(bg, params.bg_base_color, alpha)
	end

	local poses = params.pose_targets
	if poses then
		local u = tween_u(t, cfg.pose_start, cfg.pose_duration, pose_ease)
		local scale = cfg.pose_from + ((cfg.pose_to - cfg.pose_from) * u)
		local nudge = text_active and params.pose_text_nudge or 0
		for i = 1, #poses do
			apply_pose(poses[i], scale, nudge)
		end
	end

	if params.text_started == false and t >= cfg.text_start then
		if params.text_lines then
			set_text_lines(text_main.id, params.text_lines, params.text_typed)
		end
		if params.text_choice_lines then
			set_text_lines(text_choice.id, params.text_choice_lines, false)
		end
		if params.text_prompt_line then
			set_text_lines(text_prompt.id, { params.text_prompt_line }, false)
		end
		params.text_started = true
	end

	local text_u = tween_u(t, cfg.text_start, cfg.text_duration, text_ease)
	local text_alpha = cfg.text_from + ((cfg.text_to - cfg.text_from) * text_u)
	if text_main then
		apply_text_alpha(text_main, params.text_base_alpha * text_alpha)
	end
	if text_choice then
		apply_text_alpha(text_choice, params.text_base_alpha * text_alpha)
	end
	if text_prompt then
		apply_text_alpha(text_prompt, params.text_base_alpha * text_alpha)
	end
end

local function ensure_timeline(owner, preset_id, cfg)
	local timeline_id = STAGGER_TIMELINE_PREFIX .. preset_id
	if owner:get_timeline(timeline_id) then
		return timeline_id
	end
	local total = cfg.text_start + cfg.text_duration
	owner:define_timeline(new_timeline({
		id = timeline_id,
		continuous = true,
		playback_mode = 'once',
		duration_seconds = total,
		tracks = {
			stagger_track,
		},
	}))
	return timeline_id
end

local function build_pose_targets(pose_targets)
	if not pose_targets then
		return nil
	end
	local entries = {}
	for i = 1, #pose_targets do
		local obj = pose_targets[i]
		local scale = obj.sprite_component.scale
		entries[#entries + 1] = {
			obj = obj,
			base_scale_x = scale.x,
			base_scale_y = scale.y,
			base_y = obj.y,
		}
	end
	return entries
end

function stagger.play(owner, preset_id, opts)
	local cfg = presets[preset_id]
	if not cfg then
		error("[stagger] unknown preset '" .. tostring(preset_id) .. "'.")
	end
	opts = opts or {}
	local timeline_cfg = {
		bg_start = 0,
		bg_duration = cfg.bg_duration,
		pose_start = cfg.offset,
		pose_duration = cfg.pose_duration,
		text_start = cfg.offset * 2,
		text_duration = cfg.text_duration,
		bg_from = 1,
		bg_to = cfg.bg_alpha,
		pose_from = cfg.pose_from,
		pose_to = cfg.pose_to,
		text_from = 0,
		text_to = 1,
	}
	local timeline_id = ensure_timeline(owner, preset_id, timeline_cfg)
	local bg = opts.bg
	local text_main = opts.text_main
	local text_choice = opts.text_choice
	local text_prompt = opts.text_prompt
	local text_base_alpha = 1

	if bg then
		local base = bg.sprite_component.colorize
		timeline_cfg.bg_base_color = { r = base.r, g = base.g, b = base.b, a = base.a }
		if opts.bg_dim == false then
			timeline_cfg.bg_from = base.a
			timeline_cfg.bg_to = base.a
		elseif opts.bg_alpha ~= nil then
			timeline_cfg.bg_from = base.a
			timeline_cfg.bg_to = opts.bg_alpha
		end
		apply_bg_alpha(bg, timeline_cfg.bg_base_color, timeline_cfg.bg_from)
	end

	if text_main then
		text_base_alpha = text_main.text_color.a
		apply_text_alpha(text_main, 0)
	end
	if text_choice then
		apply_text_alpha(text_choice, 0)
		text_choice.highlighted_line_index = nil
	end
	if text_prompt then
		apply_text_alpha(text_prompt, 0)
	end

	if opts.text_lines == nil and text_main then
		clear_text(text_main.id)
	end

	owner.stagger_blocked = timeline_cfg.text_start > 0
	owner:stop_timeline(timeline_id)
	owner:play_timeline(timeline_id, {
		rewind = true,
		snap_to_start = true,
		params = {
			cfg = timeline_cfg,
			bg = bg,
			bg_base_color = timeline_cfg.bg_base_color,
			pose_targets = build_pose_targets(opts.pose_targets),
			text_main = text_main,
			text_choice = text_choice,
			text_prompt = text_prompt,
			text_lines = opts.text_lines,
			text_choice_lines = opts.text_choice_lines,
			text_prompt_line = opts.text_prompt_line,
			text_typed = opts.text_typed == true,
			text_started = false,
			text_base_alpha = text_base_alpha,
			pose_text_nudge = opts.pose_text_nudge or cfg.pose_text_nudge or 0,
			bg_ease = resolve_ease(cfg.bg_ease),
			pose_ease = resolve_ease(cfg.pose_ease),
			text_ease = resolve_ease(cfg.text_ease),
		},
	})
end

return stagger
