local builders<const> = {}
local globals<const> = require('globals')
local round<const> = function(x)
	if x >= 0 then
		return (x + 0.5) // 1
	end
	return -(((-x) + 0.5) // 1)
end
builders.round = round

local shake_hash<const> = function(seed)
	seed = seed ~ (seed << 13)
	seed = seed ~ (seed >> 17)
	seed = seed ~ (seed << 5)
	return seed
end

local shake_signed<const> = function(seed)
	local h<const> = shake_hash(seed)
	local u<const> = (h & 0xffff) / 0xffff
	return (u * 2) - 1
end

local panel_motion<const> = function(frame_index, panel, in_frames, hold_frames, out_frames)
	local t<const> = frame_index - panel.offset
	if t < 0 then
		return panel.x_in, panel.y, 0
	end
	if t < in_frames then
		local u<const> = t / (in_frames - 1)
		local eased<const> = easing.smoothstep(u)
		return panel.x_in + (panel.x_hold - panel.x_in) * eased, panel.y, eased
	end
	if t < (in_frames + hold_frames) then
		return panel.x_hold, panel.y, 1
	end
	local out_index<const> = t - in_frames - hold_frames
	if out_index < out_frames then
		local u<const> = out_index / (out_frames - 1)
		local eased<const> = easing.smoothstep(u)
		return panel.x_hold + (panel.x_out - panel.x_hold) * eased, panel.y, 1 - eased
	end
	return panel.x_out, panel.y, 0
end

local flash_mix<const> = function(frame_index, flash_frame)
	if frame_index < flash_frame or frame_index >= (flash_frame + globals.transition_flash_frames) then
		return 0
	end
	local u<const> = (frame_index - flash_frame) / (globals.transition_flash_frames - 1)
	return (1 - u) * globals.transition_flash_mix
end

function builders.build_all_out_shake(total_frames)
	local ramp_in_frames<const> = 10
	local ramp_out_frames<const> = 18
	local ramp_out_start<const> = total_frames - ramp_out_frames

	local swing_period_frames<const> = 10
	local swing_amp_x<const> = 28
	local swing_amp_y<const> = 10

	local jitter_amp_x<const> = 10
	local jitter_amp_y<const> = 7
	local micro_jitter_amp_x<const> = 4
	local micro_jitter_amp_y<const> = 3

	local hit_segment_len<const> = 7
	local hit_len<const> = 3
	local hit_amp_x<const> = 36
	local hit_amp_y<const> = 20
	local hit_window<const> = hit_segment_len - hit_len + 1

	local boom_frames<const> = 10
	local boom_amp_x<const> = 44
	local boom_amp_y<const> = 28

	return function(frame_index)
		if frame_index >= (total_frames - 1) then
			return 0, 0
		end

		local intensity = 1
		if frame_index < ramp_in_frames then
			local u<const> = frame_index / (ramp_in_frames - 1)
			intensity = easing.smoothstep(u)
		elseif frame_index >= ramp_out_start then
			local u<const> = (total_frames - 1 - frame_index) / (ramp_out_frames - 1)
			intensity = easing.smoothstep(u)
		end

		local swing_u<const> = (frame_index / swing_period_frames) + 0.15
		local swing = easing.pingpong01(swing_u)
		swing = (easing.ease_in_out_quad(swing) - 0.5) * 2

		local bob_u<const> = (frame_index / (swing_period_frames * 0.75)) + 0.37
		local bob<const> = (easing.smoothstep(easing.pingpong01(bob_u)) - 0.5) * 2

		local dx = (swing * swing_amp_x)
		local dy = (bob * swing_amp_y)

		dx = dx + (shake_signed(1000 + frame_index * 31 + 7) * jitter_amp_x)
		dy = dy + (shake_signed(2000 + frame_index * 47 + 13) * jitter_amp_y)
		dx = dx + (shake_signed(3000 + frame_index * 97 + 3) * micro_jitter_amp_x)
		dy = dy + (shake_signed(4000 + frame_index * 89 + 9) * micro_jitter_amp_y)

		local segment_index<const> = frame_index // hit_segment_len
		local segment_start<const> = segment_index * hit_segment_len
		local accent_at<const> = segment_start + (shake_hash(segment_index * 73 + 11) % hit_window)
		if frame_index >= accent_at and frame_index < (accent_at + hit_len) then
			local u<const> = (frame_index - accent_at) / (hit_len - 1)
			local hit_u<const> = easing.arc01(u)
			local strength<const> = 0.7 + (((shake_hash(segment_index * 53 + 7) & 0xff) / 0xff) * 0.7)
			dx = dx + (shake_signed(segment_index * 199 + frame_index * 17 + 5) * hit_amp_x * hit_u * strength)
			dy = dy + (shake_signed(segment_index * 211 + frame_index * 19 + 9) * hit_amp_y * hit_u * strength)
		end

		if frame_index < boom_frames then
			local u<const> = frame_index / (boom_frames - 1)
			local boom<const> = 1 - easing.smoothstep(u)
			dx = dx + (shake_signed(5000 + frame_index * 19 + 1) * boom_amp_x * boom)
			dy = dy + (shake_signed(6000 + frame_index * 23 + 5) * boom_amp_y * boom)
		end

		return round(dx * intensity), round(dy * intensity)
	end
end

function builders.build_combat_fade_frames()
	local frames<const> = {}
	for frame_index = 0, globals.combat_fade_frame_count - 1 do
		local a = 1
		if frame_index < globals.combat_fade_out_frames then
			local u<const> = frame_index / (globals.combat_fade_out_frames - 1)
			a = easing.smoothstep(u)
		end
		frames[#frames + 1] = {
			overlay = { r = 0, g = 0, b = 0, a = a },
		}
	end
	return frames
end

function builders.build_combat_focus_frames(params)
	local frames<const> = {}

	local base_x<const> = params.base_x
	local base_y<const> = params.base_y
	local monster_sx<const> = params.monster_sx
	local monster_sy<const> = params.monster_sy

	local zoom_target_x<const> = (machine_manifest.render_size.width - (monster_sx * globals.combat_focus_zoom_scale)) / 2
	local zoom_target_y<const> = (machine_manifest.render_size.height - (monster_sy * globals.combat_focus_zoom_scale)) / 2

	local vanish_center_x<const> = machine_manifest.render_size.width / 2
	local vanish_bottom_y<const> = zoom_target_y + (monster_sy * globals.combat_focus_zoom_scale)

	for i = 0, globals.combat_focus_zoom_frames - 1 do
		local u<const> = i / (globals.combat_focus_zoom_frames - 1)
		local eased<const> = easing.smoothstep(u)
		local turn<const> = easing.arc01(u)
		local s<const> = 1 + ((globals.combat_focus_zoom_scale - 1) * eased)
		local x<const> = base_x + (zoom_target_x - base_x) * eased + (globals.combat_focus_zoom_arc_x * turn)
		local y<const> = base_y + (zoom_target_y - base_y) * eased + (globals.combat_focus_zoom_arc_y * turn)

		frames[#frames + 1] = {
			visible = true,
			x = x,
			y = y,
			sprite_component = {
				colorize = { r = 1, g = 1, b = 1, a = 1 },
				scale = { x = s, y = s },
			},
		}
	end

	for i = 0, globals.combat_focus_vanish_frames - 1 do
		local u<const> = i / (globals.combat_focus_vanish_frames - 1)
		local eased<const> = easing.smoothstep(u)
		local melt<const> = easing.ease_out_quad(eased)
		local turn<const> = easing.arc01(u)
		local sx<const> = globals.combat_focus_zoom_scale + ((globals.combat_focus_vanish_scale_x - globals.combat_focus_zoom_scale) * melt)
		local sy<const> = globals.combat_focus_zoom_scale + ((globals.combat_focus_vanish_scale_y - globals.combat_focus_zoom_scale) * melt)
		local center_x<const> = vanish_center_x + (globals.combat_focus_vanish_arc_x * turn)
		local bottom_y<const> = vanish_bottom_y + (globals.combat_focus_vanish_lift * melt) + (globals.combat_focus_vanish_arc_y * turn)
		local x<const> = center_x - (monster_sx * sx) / 2
		local y<const> = bottom_y - (monster_sy * sy)
		local alpha<const> = 1 - easing.ease_in_quad(u)

		frames[#frames + 1] = {
			visible = alpha > 0,
			x = x,
			y = y,
			sprite_component = {
				colorize = { r = 1, g = 1, b = 1, a = alpha },
				scale = { x = sx, y = sy },
			},
		}
	end

	return frames
end

	function builders.build_combat_intro_frames(params)
		local frames<const> = {}

	local monster_sx<const> = params.monster_sx
	local monster_sy<const> = params.monster_sy
	local maya_a_sy<const> = params.maya_a_sy
	local maya_b_sx<const> = params.maya_b_sx
	local maya_b_sy<const> = params.maya_b_sy
	local monster_start_scale<const> = params.monster_start_scale
	local monster_start_x<const> = params.monster_start_x
	local monster_start_y<const> = params.monster_start_y
	local monster_base_x<const> = params.monster_base_x
	local monster_base_y<const> = params.monster_base_y
	local maya_a_start_scale<const> = params.maya_a_start_scale
	local maya_a_start_x<const> = params.maya_a_start_x
	local maya_a_base_x<const> = params.maya_a_base_x
	local maya_a_base_y<const> = params.maya_a_base_y
	local maya_b_start_scale<const> = params.maya_b_start_scale
	local maya_b_end_scale<const> = params.maya_b_end_scale
	local maya_b_start_right_x<const> = params.maya_b_start_right_x
	local maya_b_exit_right_x<const> = params.maya_b_exit_right_x
	local maya_b_base_x<const> = params.maya_b_base_x
	local maya_b_base_y<const> = params.maya_b_base_y

	local monster_start_ox<const> = (monster_sx * (monster_start_scale - 1)) / 2
	local monster_start_oy<const> = (monster_sy * (monster_start_scale - 1)) / 2
	local monster_hidden_x<const> = monster_start_x - monster_start_ox
	local monster_hidden_y<const> = monster_start_y - monster_start_oy

		local maya_a_hidden_y<const> = maya_a_base_y - (maya_a_sy * (maya_a_start_scale - 1))
			local maya_b_motion_frames<const> = globals.combat_intro_maya_b_frames - globals.combat_intro_hold_frames

			for i = 0, globals.combat_intro_maya_b_frames - 1 do
				local u = 0
				if i >= globals.combat_intro_hold_frames then
					u = (i - globals.combat_intro_hold_frames) / (maya_b_motion_frames - 1)
				end
				local eased<const> = easing.smoothstep(u)
				local whoosh<const> = easing.ease_out_back(eased)
				local move<const> = eased + ((whoosh - eased) * globals.combat_intro_whoosh_strength)
				local turn<const> = easing.arc01(u)
				local s<const> = maya_b_start_scale + (maya_b_end_scale - maya_b_start_scale) * eased
				local right_x<const> = maya_b_start_right_x + (maya_b_exit_right_x - maya_b_start_right_x) * move
				local x<const> = right_x - (maya_b_sx * s)
				local y<const> = maya_b_base_y - (maya_b_sy * (s - 1)) + (globals.combat_intro_maya_b_arc_y * turn)

				frames[#frames + 1] = {
			monster = {
				visible = false,
				x = monster_hidden_x,
				y = monster_hidden_y,
				sprite_component = { scale = { x = monster_start_scale, y = monster_start_scale } },
			},
			maya_a = {
				visible = false,
				x = maya_a_start_x,
				y = maya_a_hidden_y,
				sprite_component = { scale = { x = maya_a_start_scale, y = maya_a_start_scale } },
			},
			maya_b = {
				visible = true,
				x = x,
				y = y,
				sprite_component = { scale = { x = s, y = s } },
			},
		}
		end

			for i = 0, globals.combat_intro_reveal_frames - 1 do
				local u<const> = i / (globals.combat_intro_reveal_frames - 1)
				local eased<const> = easing.smoothstep(u)
				local whoosh<const> = easing.ease_out_back(eased)
				local move<const> = eased + ((whoosh - eased) * globals.combat_intro_whoosh_strength)
				local turn<const> = easing.arc01(u)

				local monster_scale<const> = monster_start_scale + (1 - monster_start_scale) * eased
				local monster_ox<const> = (monster_sx * (monster_scale - 1)) / 2
				local monster_oy<const> = (monster_sy * (monster_scale - 1)) / 2
				local monster_x<const> = monster_start_x + (monster_base_x - monster_start_x) * move + (globals.combat_intro_monster_arc_x * turn) - monster_ox
				local monster_y<const> = monster_start_y + (monster_base_y - monster_start_y) * eased + (globals.combat_intro_monster_arc_y * turn) - monster_oy

				local maya_a_scale<const> = maya_a_start_scale + (1 - maya_a_start_scale) * eased
				local maya_a_x<const> = maya_a_start_x + (maya_a_base_x - maya_a_start_x) * move + (globals.combat_intro_maya_a_arc_x * turn)
				local maya_a_y<const> = maya_a_base_y - (maya_a_sy * (maya_a_scale - 1)) + (globals.combat_intro_maya_a_arc_y * turn)

				frames[#frames + 1] = {
			monster = {
				visible = true,
				x = monster_x,
				y = monster_y,
				sprite_component = { scale = { x = monster_scale, y = monster_scale } },
			},
			maya_a = {
				visible = true,
				x = maya_a_x,
				y = maya_a_y,
				sprite_component = { scale = { x = maya_a_scale, y = maya_a_scale } },
			},
			maya_b = {
				visible = false,
				x = maya_b_base_x,
				y = maya_b_base_y,
				sprite_component = { scale = { x = 1, y = 1 } },
			},
		}
	end

	return frames
end

function builders.build_combat_dodge_frames(params)
	local frames<const> = {}
	local dir<const> = params.dir
	local base_x<const> = params.base_x
	local move_frames<const> = globals.combat_dodge_frame_count - globals.combat_dodge_anticipation_frames - globals.combat_dodge_peak_frames - globals.combat_dodge_recover_frames
	local move_end<const> = globals.combat_dodge_anticipation_frames + move_frames
	local peak_end<const> = move_end + globals.combat_dodge_peak_frames

	for frame_index = 0, globals.combat_dodge_frame_count - 1 do
		local offset = 0
		local scale_x = 1
		local scale_y = 1
		if frame_index < globals.combat_dodge_anticipation_frames then
			local u<const> = frame_index / (globals.combat_dodge_anticipation_frames - 1)
			offset = -combat_monster_dodge_distance * 0.2 * easing.smoothstep(u) * dir
			local t<const> = easing.smoothstep(u)
			scale_x = 1 + (globals.combat_dodge_anticipation_scale_x * t)
			scale_y = 1 + (globals.combat_dodge_anticipation_scale_y * t)
		elseif frame_index < move_end then
			local u<const> = (frame_index - globals.combat_dodge_anticipation_frames) / (move_frames - 1)
			offset = combat_monster_dodge_distance * easing.ease_out_quad(u) * dir
			local t<const> = easing.ease_out_quad(u)
			scale_x = 1 + (globals.combat_dodge_move_scale_x * t)
			scale_y = 1 + (globals.combat_dodge_move_scale_y * t)
		elseif frame_index < peak_end then
			offset = combat_monster_dodge_distance * dir
			scale_x = 1 + globals.combat_dodge_move_scale_x
			scale_y = 1 + globals.combat_dodge_move_scale_y
		else
			local u<const> = (frame_index - peak_end) / (globals.combat_dodge_recover_frames - 1)
			local t<const> = 1 - easing.ease_in_quad(u)
			offset = combat_monster_dodge_distance * t * dir
			scale_x = 1 + (globals.combat_dodge_move_scale_x * t)
			scale_y = 1 + (globals.combat_dodge_move_scale_y * t)
		end
		frames[#frames + 1] = {
			x = base_x + offset,
			sprite_component = { scale = { x = scale_x, y = scale_y } },
		}
	end

	return frames
end

function builders.build_combat_exchange_frames(params)
	local frames<const> = {}
	local frame_count<const> = params.frame_count
	local monster_base_x<const> = params.monster_base_x
	local monster_base_y<const> = params.monster_base_y
	local maya_base_x<const> = params.maya_base_x
	local maya_base_y<const> = params.maya_base_y
	local maya_hold_frames<const> = params.maya_hold_frames or 0
	local maya_recover_frames<const> = params.maya_recover_frames or 0
	local maya_bob_amp<const> = params.maya_bob_amp
	local maya_bob_period_frames<const> = params.maya_bob_period_frames
	local maya_react_scale_x<const> = params.maya_react_scale_x
	local maya_react_scale_y<const> = params.maya_react_scale_y
	local maya_impact_scale_x<const> = params.maya_impact_scale_x
	local maya_impact_scale_y<const> = params.maya_impact_scale_y
	local recover_frames<const> = frame_count - globals.combat_exchange_anticipate_frames - globals.combat_exchange_lunge_frames - globals.combat_exchange_hitstop_frames
	local lunge_end<const> = globals.combat_exchange_anticipate_frames + globals.combat_exchange_lunge_frames
	local hitstop_end<const> = lunge_end + globals.combat_exchange_hitstop_frames
	local impact_start<const> = lunge_end
	local impact_end<const> = (frame_count - 1) - (maya_hold_frames + maya_recover_frames)
	local impact_frames<const> = impact_end - impact_start + 1
	local maya_hold_end<const> = impact_end + maya_hold_frames
	local maya_recover_end<const> = maya_hold_end + maya_recover_frames

	local ease_u<const> = function(u, frames)
		local e = easing.smoothstep(u)
		if frames <= 6 then
			e = easing.smoothstep(e)
		end
		return e
	end

	for i = 0, frame_count - 1 do
		local lunge = 0
		if i < globals.combat_exchange_anticipate_frames then
			local u<const> = i / (globals.combat_exchange_anticipate_frames - 1)
			lunge = -0.10 * easing.smoothstep(u)
		elseif i < lunge_end then
			local u<const> = (i - globals.combat_exchange_anticipate_frames) / (globals.combat_exchange_lunge_frames - 1)
			lunge = easing.ease_in_out_quad(u)
		elseif i < hitstop_end then
			lunge = 1.0
		else
			local u<const> = (i - hitstop_end) / (recover_frames - 1)
			lunge = 1.0 - easing.ease_in_quad(u)
		end

		local impact_u = 0
		if i >= impact_start and i <= impact_end then
			local ru<const> = (i - impact_start) / (impact_frames - 1)
			impact_u = easing.arc01(ease_u(ru, impact_frames))
		end

		local maya_u = 0
		if i >= impact_start and i <= impact_end then
			local ru<const> = (i - impact_start) / (impact_frames - 1)
			maya_u = ease_u(ru, impact_frames)
		elseif i > impact_end and i <= maya_hold_end then
			maya_u = 1
		elseif i > maya_hold_end and i <= maya_recover_end and maya_recover_frames > 0 then
			local ru<const> = (i - maya_hold_end) / (maya_recover_frames - 1)
			maya_u = 1 - ease_u(ru, maya_recover_frames)
		end

		local forward = lunge
		if forward < 0 then
			forward = 0
		end

		local monster_x = monster_base_x - (globals.combat_exchange_lunge_distance * forward)
		local monster_y = monster_base_y + (globals.combat_exchange_lunge_lift * forward)
		if impact_u > 0 then
			monster_x = monster_x - (globals.combat_exchange_lunge_distance * globals.combat_exchange_lunge_punch * impact_u)
			monster_y = monster_y + (globals.combat_exchange_lunge_lift * globals.combat_exchange_lunge_punch * impact_u)
		end

		local s = 1
		if lunge < 0 then
			s = 1 - (0.04 * (-lunge))
		else
			s = 1 + ((globals.combat_exchange_lunge_scale - 1) * forward)
		end

		local maya_x = maya_base_x
		local maya_y = maya_base_y
		local maya_scale = { x = 1, y = 1 }
		local maya_colorize = { r = 1, g = 1, b = 1, a = 1 }
		local overlay_alpha = 0
		local bob = 0

			if maya_u > 0 then
				maya_x = maya_x + (params.maya_offset_x * maya_u)
				maya_y = maya_y + (params.maya_offset_y * maya_u)
				maya_scale = {
					x = 1 + (maya_react_scale_x * maya_u),
					y = 1 + (maya_react_scale_y * maya_u),
				}
				local bob_u<const> = easing.smoothstep(easing.pingpong01((i - impact_start) / maya_bob_period_frames))
				bob = (bob_u - 0.5) * 2 * maya_bob_amp
			end

		if impact_u > 0 then
			if params.squash then
				maya_scale = {
					x = maya_scale.x + (maya_impact_scale_x * impact_u),
					y = maya_scale.y + (maya_impact_scale_y * impact_u),
				}
			end
			if params.flash then
				local flash_index<const> = i - impact_start
				if (flash_index % 2) == 1 then
					maya_colorize = { r = params.flash_r, g = params.flash_g, b = params.flash_b, a = 1 }
				end
			end
			local cam_dx<const> = round(shake_signed(i * 19 + 5) * params.cam_shake_x * impact_u)
			local cam_dy<const> = round(shake_signed(i * 23 + 11) * params.cam_shake_y * impact_u)
			monster_x = monster_x + cam_dx
			monster_y = monster_y + cam_dy
			maya_x = maya_x + cam_dx
			maya_y = maya_y + cam_dy
			overlay_alpha = params.overlay_alpha * impact_u
		end
		maya_y = maya_y + bob

		local overlay_colorize = { r = 0, g = 0, b = 0, a = 0 }
		if overlay_alpha > 0 then
			overlay_colorize = { r = params.flash_r, g = params.flash_g, b = params.flash_b, a = overlay_alpha }
		end

		frames[#frames + 1] = {
			monster = {
				x = monster_x,
				y = monster_y,
				sprite_component = {
					colorize = { r = 1, g = 1, b = 1, a = 1 },
					scale = { x = s, y = s },
				},
			},
			maya_a = {
				x = maya_x,
				y = maya_y,
				sprite_component = {
					colorize = maya_colorize,
					scale = maya_scale,
				},
			},
			overlay = overlay_colorize,
		}
	end

	return frames
end

function builders.build_combat_all_out_frames(params)
	local frames<const> = {}
	local origin_x<const> = params.origin_x
	local origin_y<const> = params.origin_y
	local sprite_w<const> = params.sprite_w
	local sprite_h<const> = params.sprite_h
	local shake<const> = params.shake

	for frame_index = 0, combat_all_out_frame_count - 1 do
		local dx<const> , dy<const> = shake(frame_index)
		local u<const> = (frame_index / combat_all_out_pulse_period_frames) + 0.25
		local pulse<const> = easing.smoothstep(easing.pingpong01(u))
		local s_base<const> = 1 + (pulse * combat_all_out_pulse_amp)
		local squash_u<const> = (frame_index / (combat_all_out_pulse_period_frames * 0.5)) + 0.15
		local squash = easing.pingpong01(squash_u)
		squash = (easing.ease_in_out_quad(squash) - 0.5) * 2
		local jitter<const> = shake_signed(7000 + frame_index * 29 + 9) * 0.04
		local sx<const> = s_base + (squash * combat_all_out_pulse_amp * 0.6) + jitter
		local sy<const> = s_base - (squash * combat_all_out_pulse_amp * 0.4) - (jitter * 0.6)
		local ox<const> = (sprite_w * (sx - 1)) / 2
		local oy<const> = (sprite_h * (sy - 1)) / 2
		frames[#frames + 1] = {
			x = origin_x + dx - ox,
			y = origin_y + dy - oy,
			sprite_component = { scale = { x = sx, y = sy } },
		}
	end

	return frames
end

function builders.build_combat_hit_frames(params)
	local frames<const> = {}
	local base_x<const> = params.base_x
	local base_y<const> = params.base_y
	local monster_sx<const> = params.monster_sx
	local monster_sy<const> = params.monster_sy
	local move_frames<const> = globals.combat_hit_frame_count - globals.combat_hit_stop_frames - globals.combat_hit_peak_frames - globals.combat_hit_recover_frames
	local peak_start<const> = globals.combat_hit_stop_frames + move_frames
	local recover_start<const> = peak_start + globals.combat_hit_peak_frames
	local slash_end<const> = recover_start - 1
	local path_dx<const> = (globals.combat_hit_slash_path_end_x_ratio - globals.combat_hit_slash_path_start_x_ratio) * monster_sx
	local path_dy<const> = (globals.combat_hit_slash_path_end_y_ratio - globals.combat_hit_slash_path_start_y_ratio) * monster_sy
	local path_len<const> = math.sqrt((path_dx * path_dx) + (path_dy * path_dy))
	local path_nx<const> = path_dx / path_len
	local path_ny<const> = path_dy / path_len
	local base_length<const> = monster_sx * globals.combat_hit_slash_length_ratio
	local base_thickness<const> = monster_sy * globals.combat_hit_slash_thickness_ratio

	for frame_index = 0, globals.combat_hit_frame_count - 1 do
		local kick = 0
		if frame_index >= globals.combat_hit_stop_frames and frame_index < peak_start then
			local u<const> = (frame_index - globals.combat_hit_stop_frames) / (move_frames - 1)
			kick = easing.ease_out_quad(u)
		elseif frame_index >= peak_start and frame_index < recover_start then
			kick = 1
		elseif frame_index >= recover_start then
			local u<const> = (frame_index - recover_start) / (globals.combat_hit_recover_frames - 1)
			kick = 1 - easing.ease_in_quad(u)
		end

		local dx = globals.combat_hit_knockback_x * kick
		local dy = globals.combat_hit_knockback_y * kick
		if frame_index >= globals.combat_hit_stop_frames and frame_index < (globals.combat_hit_stop_frames + globals.combat_hit_shake_frames) then
			local k<const> = frame_index - globals.combat_hit_stop_frames
			local intensity<const> = (globals.combat_hit_shake_frames - k) / globals.combat_hit_shake_frames
			dx = dx + round(shake_signed(frame_index * 31 + 7) * globals.combat_hit_shake_x * intensity)
			dy = dy + round(shake_signed(frame_index * 37 + 11) * globals.combat_hit_shake_y * intensity)
		end

		local monster_x<const> = base_x + dx
		local monster_y<const> = base_y + dy
		local monster_scale<const> = {
			x = 1 + (globals.combat_hit_scale_x * kick),
			y = 1 + (globals.combat_hit_scale_y * kick),
		}

		local monster_colorize = { r = 1, g = 1, b = 1, a = 1 }
		if frame_index >= globals.combat_hit_stop_frames and frame_index < recover_start then
			local flash_index<const> = frame_index - globals.combat_hit_stop_frames
			if (flash_index % 2) == 1 then
				monster_colorize = { r = 1, g = 0.2, b = 0.2, a = 1 }
			end
		end

		local slash_active<const> = frame_index >= globals.combat_hit_stop_frames and frame_index <= slash_end
		local slash_points = { 0, 0, 0, 0 }
		local slash_thickness = 0
		local slash_color = 0x00ffffff
		if slash_active then
			local u<const> = (frame_index - globals.combat_hit_stop_frames) / (slash_end - globals.combat_hit_stop_frames)
			local arc<const> = easing.arc01(u)
			local center_x<const> = monster_x + (monster_sx * (globals.combat_hit_slash_path_start_x_ratio + ((globals.combat_hit_slash_path_end_x_ratio - globals.combat_hit_slash_path_start_x_ratio) * u)))
			local center_y<const> = monster_y + (monster_sy * (globals.combat_hit_slash_path_start_y_ratio + ((globals.combat_hit_slash_path_end_y_ratio - globals.combat_hit_slash_path_start_y_ratio) * u)))
			local scale<const> = 1 + ((globals.combat_hit_slash_peak_scale - 1) * arc)
			local half<const> = (base_length * scale) / 2
			local x0<const> = center_x - (path_nx * half)
			local y0<const> = center_y - (path_ny * half)
			local x1<const> = center_x + (path_nx * half)
			local y1<const> = center_y + (path_ny * half)
			slash_points = { x0, y0, x1, y1 }
			slash_thickness = base_thickness * (globals.combat_hit_slash_taper_floor + ((1 - globals.combat_hit_slash_taper_floor) * arc))
			slash_color = (((globals.combat_hit_slash_alpha * arc * 255 + 0.5) // 1) << 24) | 0x00ffffff
		end

		frames[#frames + 1] = {
			monster = {
				x = monster_x,
				y = monster_y,
				sprite_component = {
					colorize = monster_colorize,
					scale = monster_scale,
				},
			},
			slash_frame = {
				slash_active = slash_active,
				slash_points = slash_points,
				slash_thickness = slash_thickness,
				slash_color = slash_color,
				slash_z = combat_hit_slash_z,
			},
		}
	end

	return frames
end

function builders.build_combat_results_fade_in_frames(params)
	local frames<const> = {}
	local maya_start_x<const> = params.maya_start_x
	local maya_target_x<const> = params.maya_target_x
	local text_start_x<const> = params.text_start_x
	local text_target_x<const> = params.text_target_x

	for frame_index = 0, globals.combat_results_fade_in_frames - 1 do
		local u<const> = frame_index / (globals.combat_results_fade_in_frames - 1)
		local a<const> = easing.smoothstep(u)
		frames[#frames + 1] = {
			bg = {
				r = combat_results_bg_r,
				g = combat_results_bg_g,
				b = combat_results_bg_b,
				a = combat_results_bg_a * a,
			},
			maya_b = {
				sprite_component = { colorize = { r = 1, g = 1, b = 1, a = a } },
				x = maya_start_x + (maya_target_x - maya_start_x) * a,
			},
			results = {
				text_color = { r = 1, g = 1, b = 1, a = a },
				centered_block_x = text_start_x + (text_target_x - text_start_x) * a,
			},
		}
	end

	return frames
end

function builders.build_combat_results_fade_out_frames()
	local frames<const> = {}
	for frame_index = 0, globals.combat_results_fade_out_frames - 1 do
		local u<const> = frame_index / (globals.combat_results_fade_out_frames - 1)
		local a<const> = 1 - easing.smoothstep(u)
		frames[#frames + 1] = {
			bg = {
				r = combat_results_bg_r,
				g = combat_results_bg_g,
				b = combat_results_bg_b,
				a = combat_results_bg_a * a,
			},
			maya_b = {
				sprite_component = { colorize = { r = 1, g = 1, b = 1, a = a } },
			},
			results = {
				text_color = { r = 1, g = 1, b = 1, a = a },
			},
		}
	end
	return frames
end

function builders.build_combat_exit_fade_in_frames()
	local frames<const> = {}
	for frame_index = 0, globals.combat_exit_fade_in_frames - 1 do
		local u<const> = frame_index / (globals.combat_exit_fade_in_frames - 1)
		local c<const> = easing.smoothstep(u)
		frames[#frames + 1] = {
			sprite_component = {
				colorize = { r = c, g = c, b = c, a = 1 },
			},
		}
	end
	return frames
end

function builders.build_transition_frames(params)
	local frames<const> = {}
	local fade_out_frames<const> = params.fade_out_frames
	local fade_in_frames<const> = params.fade_in_frames
	local fade_in_start<const> = params.fade_in_start
	local finish_frame<const> = params.finish_frame
	local skip_fade<const> = params.skip_fade
	local palette<const> = params.palette
	local panels<const> = params.panels
	local accent_panel<const> = params.accent
	local center_x<const> = params.center_x
	local start_x<const> = params.start_x
	local end_x<const> = params.end_x
	local swap_frame<const> = fade_out_frames - 1
	local text_out_start<const> = globals.transition_text_in_frames + globals.transition_text_hold_frames
	local text_out_end<const> = text_out_start + globals.transition_text_out_frames
	local base<const> = palette.overlay
	local accent<const> = palette.accent

	for frame_index = 0, finish_frame do
		local fade_alpha = 1
		if not skip_fade then
			if frame_index < fade_out_frames then
				local u<const> = frame_index / (fade_out_frames - 1)
				fade_alpha = easing.smoothstep(u)
			elseif frame_index < fade_in_start then
				fade_alpha = 1
			else
				local u<const> = (frame_index - fade_in_start) / (fade_in_frames - 1)
				fade_alpha = 1 - easing.smoothstep(u)
			end
		end

		local mix<const> = skip_fade and 0 or flash_mix(frame_index, swap_frame)
		local overlay_r<const> = base.r + (accent.r - base.r) * mix
		local overlay_g<const> = base.g + (accent.g - base.g) * mix
		local overlay_b<const> = base.b + (accent.b - base.b) * mix

			local panel_states<const> = {}
			for i = 1, #panels do
				local panel<const> = panels[i]
				local x<const> , y<const> , a<const> = panel_motion(frame_index, panel, globals.transition_panel_in_frames, globals.transition_panel_hold_frames, globals.transition_panel_out_frames)
				panel_states[i] = {
					visible = a > 0,
					x = x,
					y = y,
					r = panel.color.r,
					g = panel.color.g,
					b = panel.color.b,
					a = a,
				}
			end

		local ax<const> , ay<const> , aa<const> = panel_motion(frame_index, accent_panel, globals.transition_accent_in_frames, globals.transition_accent_hold_frames, globals.transition_accent_out_frames)

		local text_x = end_x
		if frame_index < globals.transition_text_in_frames then
			local u<const> = frame_index / (globals.transition_text_in_frames - 1)
			text_x = start_x + (center_x - start_x) * easing.smoothstep(u)
		elseif frame_index < text_out_start then
			text_x = center_x
		elseif frame_index < text_out_end then
			local out_index<const> = frame_index - text_out_start
			local u<const> = out_index / (globals.transition_text_out_frames - 1)
			text_x = center_x + (end_x - center_x) * easing.smoothstep(u)
		end

			frames[#frames + 1] = {
				overlay = { r = overlay_r, g = overlay_g, b = overlay_b, a = fade_alpha },
				panels = panel_states,
				accent = {
					visible = aa > 0,
					x = ax,
					y = ay,
					r = accent_panel.color.r,
					g = accent_panel.color.g,
					b = accent_panel.color.b,
					a = aa,
				},
				text = { centered_block_x = text_x },
			}
	end

	return frames
end

function builders.build_transition_fade_in_frames(palette)
	local frames<const> = {}
	local base<const> = palette.overlay
		for frame_index = 0, globals.overgang_fade_in_frames - 1 do
			local u<const> = frame_index / (globals.overgang_fade_in_frames - 1)
			local a<const> = 1 - easing.smoothstep(u)
			frames[#frames + 1] = {
				overlay = { r = base.r, g = base.g, b = base.b, a = a },
			}
		end
	return frames
end

function builders.build_fade_frames(params)
	local frames<const> = {}
	local palette<const> = params.palette
	local hold_black<const> = params.hold_black
	local base<const> = palette.overlay
	local accent<const> = palette.accent
	local swap_frame<const> = globals.fade_out_frames - 1
	local fade_in_start<const> = globals.fade_out_frames + globals.fade_hold_frames

	for frame_index = 0, globals.fade_frame_count - 1 do
		local a = 0
		if frame_index < globals.fade_out_frames then
			local u<const> = frame_index / (globals.fade_out_frames - 1)
			a = easing.smoothstep(u)
		else
			if hold_black then
				a = 1
			elseif frame_index < fade_in_start then
				a = 1
			else
				local u<const> = (frame_index - fade_in_start) / (globals.fade_in_frames - 1)
				a = 1 - easing.smoothstep(u)
			end
		end
		local mix<const> = flash_mix(frame_index, swap_frame)
		local overlay_r<const> = base.r + (accent.r - base.r) * mix
		local overlay_g<const> = base.g + (accent.g - base.g) * mix
			local overlay_b<const> = base.b + (accent.b - base.b) * mix
			frames[#frames + 1] = {
				overlay = { r = overlay_r, g = overlay_g, b = overlay_b, a = a },
			}
		end

	return frames
end

return builders
