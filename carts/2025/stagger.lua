local stagger<const> = {}
require('globals')
local linear<const> = require('bios/easing').linear
local ease_out_quad<const> = require('bios/easing').ease_out_quad
local ease_out_back<const> = require('bios/easing').ease_out_back
local smoothstep<const> = require('bios/easing').smoothstep
local color<const> = require('bios/common/color')
local round_number<const> = require('bios/util/round_to_nearest')
local stagger_timeline_prefix<const> = 'p3.stagger.'

local presets<const> = {
	calm = {
		offset = 0.15,
		bg_duration = 0.18,
		pose_duration = 0.2,
		text_duration = 0.18,
		bg_brightness = 0.75,
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
		bg_brightness = 0.78,
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
		bg_brightness = 0.7,
		pose_from = 0.97,
		pose_to = 1.0,
		pose_text_nudge = 2,
		bg_ease = 'quad',
		pose_ease = 'back',
		text_ease = 'quad',
	},
}

local ease_out_quart<const> = function(u)
	local x<const> = 1 - u
	return 1 - (x * x * x * x)
end

local resolve_ease<const> = function(kind)
	if kind == 'quad' then
		return ease_out_quad
	end
	if kind == 'back' then
		return ease_out_back
	end
	if kind == 'quart' then
		return ease_out_quart
	end
	return smoothstep
end

local tween_u<const> = function(time, start_time, duration, ease)
	local u = (time - start_time) / duration
	u = linear(u)
	return ease(u)
end

local pose_apply<const> = function(entry, scale, nudge)
	local obj<const> = entry.obj
	local sc<const> = obj.sprite_component
	local target<const> = sc.scale
	target.x = entry.base_scale_x * scale
	target.y = entry.base_scale_y * scale
	obj.y = entry.base_y + nudge
end

local stagger_track<const> = function(target, params, event)
	local cfg<const> = params.cfg
	local t<const> = event.time_ms * 0.001
	local bg<const> = params.bg
	local text_main<const> = params.text_main
	local text_choice<const> = params.text_choice
	local text_prompt<const> = params.text_prompt
	local bg_ease<const> = params.bg_ease
	local pose_ease<const> = params.pose_ease
	local text_ease<const> = params.text_ease
	local text_active<const> = text_main ~= nil and text_main:is_typing()

	target.stagger_blocked = t < cfg.text_start

	if bg then
		local u<const> = tween_u(t, cfg.bg_start, cfg.bg_duration, bg_ease)
		local brightness<const> = cfg.bg_from + ((cfg.bg_to - cfg.bg_from) * u)
		bg.sprite_component.color = color.mix_rgb_with_alpha(p3_black_color, params.bg_base_color, round_number(brightness * 255), 1)
	end

	local poses<const> = params.pose_targets
	if poses then
		local u<const> = tween_u(t, cfg.pose_start, cfg.pose_duration, pose_ease)
		local scale<const> = cfg.pose_from + ((cfg.pose_to - cfg.pose_from) * u)
		local nudge<const> = text_active and params.pose_text_nudge or 0
		for i = 1, #poses do
			pose_apply(poses[i], scale, nudge)
		end
	end

	if not params.text_started and t >= cfg.text_start then
		if params.text_lines then
			text_main:set_text(params.text_lines, { typed = params.text_typed, snap = not params.text_typed })
		end
		if params.text_choice_lines then
			text_choice:set_text(params.text_choice_lines, { typed = false, snap = true })
		end
		if params.text_prompt_line then
			text_prompt:set_text({ params.text_prompt_line }, { typed = false, snap = true })
		end
		params.text_started = true
	end

	local text_u<const> = tween_u(t, cfg.text_start, cfg.text_duration, text_ease)
	local text_brightness<const> = cfg.text_from + ((cfg.text_to - cfg.text_from) * text_u)
	local text_level<const> = round_number(text_brightness * 255)
	if text_main then
		text_main.text_color = color.mix_rgb_with_alpha(p3_black_color, params.text_main_base_color, text_level, 1)
	end
	if text_choice then
		text_choice.text_color = color.mix_rgb_with_alpha(p3_black_color, params.text_choice_base_color, text_level, 1)
	end
	if text_prompt then
		text_prompt.text_color = color.mix_rgb_with_alpha(p3_black_color, params.text_prompt_base_color, text_level, 1)
	end
end

local ensure_timeline<const> = function(owner, preset_id, cfg)
	local timeline_id<const> = stagger_timeline_prefix .. preset_id
	if owner:get_timeline(timeline_id) then
		return timeline_id
	end
	local total<const> = cfg.text_start + cfg.text_duration
	owner:define_timeline(timeline.new({
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

local build_pose_targets<const> = function(pose_targets)
	if not pose_targets then
		return nil
	end
	local entries<const> = {}
	for i = 1, #pose_targets do
		local obj<const> = pose_targets[i]
		local scale<const> = obj.sprite_component.scale
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
	local cfg<const> = presets[preset_id]
	opts = opts or {}
	local timeline_cfg<const> = {
		bg_start = 0,
		bg_duration = cfg.bg_duration,
		pose_start = cfg.offset,
		pose_duration = cfg.pose_duration,
		text_start = 0,
		text_duration = cfg.text_duration,
		bg_from = 1,
		bg_to = cfg.bg_brightness,
		pose_from = cfg.pose_from,
		pose_to = cfg.pose_to,
		text_from = 0,
		text_to = 1,
	}
	local timeline_id<const> = ensure_timeline(owner, preset_id, timeline_cfg)
	local bg<const> = opts.bg
	local text_main<const> = opts.text_main
	local text_choice<const> = opts.text_choice
	local text_prompt<const> = opts.text_prompt
	local text_main_base_color
	local text_choice_base_color
	local text_prompt_base_color

	if bg then
		local base<const> = bg.sprite_component.color
		timeline_cfg.bg_base_color = base
		timeline_cfg.bg_from = 1
		if opts.bg_dim ~= nil and not opts.bg_dim then
			timeline_cfg.bg_to = 1
		elseif opts.bg_brightness ~= nil then
			timeline_cfg.bg_to = opts.bg_brightness
		end
		bg.sprite_component.color = base
	end

	if text_main then
		text_main_base_color = text_main.text_color
		text_main.text_color = p3_black_color
	end
	if text_choice then
		text_choice_base_color = text_choice.text_color
		text_choice.text_color = p3_black_color
		text_choice.highlighted_line_index = nil
	end
	if text_prompt then
		text_prompt_base_color = text_prompt.text_color
		text_prompt.text_color = p3_black_color
	end

	if opts.text_lines == nil and text_main then
		text_main:set_text({}, { typed = false, snap = true })
		text_main.highlighted_line_index = nil
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
			text_typed = opts.text_typed,
			text_started = false,
			text_main_base_color = text_main_base_color,
			text_choice_base_color = text_choice_base_color,
			text_prompt_base_color = text_prompt_base_color,
			pose_text_nudge = opts.pose_text_nudge or cfg.pose_text_nudge or 0,
			bg_ease = resolve_ease(cfg.bg_ease),
			pose_ease = resolve_ease(cfg.pose_ease),
			text_ease = resolve_ease(cfg.text_ease),
		},
	})
end

return stagger
