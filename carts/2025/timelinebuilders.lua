local builders<const> = {}
require('globals')
local round_number<const> = math.round
local smoothstep<const> = require('cartlib/easing').smoothstep
local pingpong01<const> = require('cartlib/easing').pingpong01
local ease_in_out_quad<const> = require('cartlib/easing').ease_in_out_quad
local arc01<const> = require('cartlib/easing').arc01
local ease_out_quad<const> = require('cartlib/easing').ease_out_quad
local ease_in_quad<const> = require('cartlib/easing').ease_in_quad
local ease_out_back<const> = require('cartlib/easing').ease_out_back
local sqrt<const> = math.sqrt
local combat_pose<const> = require('combat_pose')
local color<const> = require('cartlib/color')

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
		local eased<const> = smoothstep(u)
		return panel.x_in + (panel.x_hold - panel.x_in) * eased, panel.y, eased
	end
	if t < (in_frames + hold_frames) then
		return panel.x_hold, panel.y, 1
	end
	local out_index<const> = t - in_frames - hold_frames
	if out_index < out_frames then
		local u<const> = out_index / (out_frames - 1)
		local eased<const> = smoothstep(u)
		return panel.x_hold + (panel.x_out - panel.x_hold) * eased, panel.y, 1 - eased
	end
	return panel.x_out, panel.y, 0
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
			intensity = smoothstep(u)
		elseif frame_index >= ramp_out_start then
			local u<const> = (total_frames - 1 - frame_index) / (ramp_out_frames - 1)
			intensity = smoothstep(u)
		end

		local swing_u<const> = (frame_index / swing_period_frames) + 0.15
		local swing = pingpong01(swing_u)
		swing = (ease_in_out_quad(swing) - 0.5) * 2

		local bob_u<const> = (frame_index / (swing_period_frames * 0.75)) + 0.37
		local bob<const> = (smoothstep(pingpong01(bob_u)) - 0.5) * 2

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
			local hit_u<const> = arc01(u)
			local strength<const> = 0.7 + (((shake_hash(segment_index * 53 + 7) & 0xff) / 0xff) * 0.7)
			dx = dx + (shake_signed(segment_index * 199 + frame_index * 17 + 5) * hit_amp_x * hit_u * strength)
			dy = dy + (shake_signed(segment_index * 211 + frame_index * 19 + 9) * hit_amp_y * hit_u * strength)
		end

		if frame_index < boom_frames then
			local u<const> = frame_index / (boom_frames - 1)
			local boom<const> = 1 - smoothstep(u)
			dx = dx + (shake_signed(5000 + frame_index * 19 + 1) * boom_amp_x * boom)
			dy = dy + (shake_signed(6000 + frame_index * 23 + 5) * boom_amp_y * boom)
		end

		return round_number(dx * intensity), round_number(dy * intensity)
	end
end

-- Admission derives invariant geometry and phase boundaries once. Each range
-- sample below contains only the selected animation's current scalar work.
function builders.prepare_combat_sample(kind, params)
	if kind == 'focus' then
		params.zoom_target_x = (screen_width - params.monster_width * combat_focus_zoom_scale) / 2
		params.zoom_target_y = (screen_height - params.monster_height * combat_focus_zoom_scale) / 2
		params.vanish_bottom_y = params.zoom_target_y + params.monster_height * combat_focus_zoom_scale
	elseif kind == 'intro' then
		params.monster_hidden_x = params.monster_start_x - params.monster_width * (params.monster_start_scale - 1) / 2
		params.monster_hidden_y = params.monster_start_y - params.monster_height * (params.monster_start_scale - 1) / 2
		params.maya_a_hidden_y = params.maya_a_base_y - params.maya_a_height * (params.maya_a_start_scale - 1)
	elseif kind == 'hit' then
		local dx<const> = (combat_hit_slash_path_end_x_ratio - combat_hit_slash_path_start_x_ratio) * params.monster_width
		local dy<const> = (combat_hit_slash_path_end_y_ratio - combat_hit_slash_path_start_y_ratio) * params.monster_height
		local length<const> = sqrt(dx * dx + dy * dy)
		params.path_nx, params.path_ny = dx / length, dy / length
		params.slash_length = params.monster_width * combat_hit_slash_length_ratio
		params.slash_thickness = params.monster_height * combat_hit_slash_thickness_ratio
	elseif kind == 'exchange' then
		params.recover_frames = params.frame_count - combat_exchange_anticipate_frames - combat_exchange_lunge_frames - combat_exchange_hitstop_frames
		params.impact_end = params.frame_count - 1 - params.maya_hold_frames - params.maya_recover_frames
		params.impact_frames = params.impact_end - combat_exchange_anticipate_frames - combat_exchange_lunge_frames + 1
		params.maya_hold_end = params.impact_end + params.maya_hold_frames
		params.maya_recover_end = params.maya_hold_end + params.maya_recover_frames
	end
	return params
end

local intro_maya_b_motion_frames<const> = combat_intro_maya_b_frames - combat_intro_hold_frames
local dodge_move_frames<const> = combat_dodge_frame_count - combat_dodge_anticipation_frames - combat_dodge_peak_frames - combat_dodge_recover_frames
local dodge_move_end<const> = combat_dodge_anticipation_frames + dodge_move_frames
local dodge_peak_end<const> = dodge_move_end + combat_dodge_peak_frames
local exchange_lunge_end<const> = combat_exchange_anticipate_frames + combat_exchange_lunge_frames
local exchange_hitstop_end<const> = exchange_lunge_end + combat_exchange_hitstop_frames
local hit_move_frames<const> = combat_hit_frame_count - combat_hit_stop_frames - combat_hit_peak_frames - combat_hit_recover_frames
local hit_peak_start<const> = combat_hit_stop_frames + hit_move_frames
local hit_recover_start<const> = hit_peak_start + combat_hit_peak_frames
local hit_slash_end<const> = hit_recover_start - 1

function builders.apply_combat_fade_frames(target, frame_index, params)

	local a = 1
	if frame_index < combat_fade_out_frames then
		local u<const> = frame_index / (combat_fade_out_frames - 1)
		a = smoothstep(u)
	end
	local level<const> = round_number(a * 255)
	target.overlay.color = 0
	target.overlay.blend_color = level == 0 and 0 or color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)

end

function builders.apply_combat_focus_frames(target, frame_index, params)

	local base_x<const> = params.base_x
	local base_y<const> = params.base_y
	local monster_width<const> = params.monster_width
	local monster_height<const> = params.monster_height

	local zoom_target_x<const> = params.zoom_target_x
	local zoom_target_y<const> = params.zoom_target_y

	local vanish_center_x<const> = screen_width / 2
	local vanish_bottom_y<const> = params.vanish_bottom_y

	if frame_index < combat_focus_zoom_frames then
		local i<const> = frame_index
		local u<const> = i / (combat_focus_zoom_frames - 1)
		local eased<const> = smoothstep(u)
		local turn<const> = arc01(u)
		local s<const> = 1 + ((combat_focus_zoom_scale - 1) * eased)
		local x<const> = base_x + (zoom_target_x - base_x) * eased + (combat_focus_zoom_arc_x * turn)
		local y<const> = base_y + (zoom_target_y - base_y) * eased + (combat_focus_zoom_arc_y * turn)

		target:set_presentation_affine(s, 0, 0, s, x - target.attachment_ox, y - target.attachment_oy)

		target.visible = true

		target.color = p3_white_color
		return
	end

	local i<const> = frame_index - (combat_focus_zoom_frames)
	local u<const> = i / (combat_focus_vanish_frames - 1)
	local eased<const> = smoothstep(u)
	local melt<const> = ease_out_quad(eased)
	local turn<const> = arc01(u)
	local sx<const> = combat_focus_zoom_scale + ((combat_focus_vanish_scale_x - combat_focus_zoom_scale) * melt)
	local sy<const> = combat_focus_zoom_scale + ((combat_focus_vanish_scale_y - combat_focus_zoom_scale) * melt)
	local center_x<const> = vanish_center_x + (combat_focus_vanish_arc_x * turn)
	local bottom_y<const> = vanish_bottom_y + (combat_focus_vanish_lift * melt) + (combat_focus_vanish_arc_y * turn)
	local x<const> = center_x - (monster_width * sx) / 2
	local y<const> = bottom_y - (monster_height * sy)
	local level<const> = round_number((1 - ease_in_quad(u)) * 255)

	target:set_presentation_affine(sx, 0, 0, sy, x - target.attachment_ox, y - target.attachment_oy)

	target.visible = level > 0

	target.color = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)

end

function builders.apply_combat_intro_frames(target, frame_index, params)

	local monster_width<const> = params.monster_width
	local monster_height<const> = params.monster_height
	local maya_a_height<const> = params.maya_a_height
	local maya_b_width<const> = params.maya_b_width
	local maya_b_height<const> = params.maya_b_height
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

	local monster_hidden_x<const> = params.monster_hidden_x
	local monster_hidden_y<const> = params.monster_hidden_y

	local maya_a_hidden_y<const> = params.maya_a_hidden_y
	local maya_b_motion_frames<const> = intro_maya_b_motion_frames

	if frame_index < combat_intro_maya_b_frames then
		local i<const> = frame_index
		local u = 0
		if i >= combat_intro_hold_frames then
			u = (i - combat_intro_hold_frames) / (maya_b_motion_frames - 1)
		end
		local eased<const> = smoothstep(u)
		local whoosh<const> = ease_out_back(eased)
		local move<const> = eased + ((whoosh - eased) * combat_intro_whoosh_strength)
		local turn<const> = arc01(u)
		local s<const> = maya_b_start_scale + (maya_b_end_scale - maya_b_start_scale) * eased
		local right_x<const> = maya_b_start_right_x + (maya_b_exit_right_x - maya_b_start_right_x) * move
		local x<const> = right_x - (maya_b_width * s)
		local y<const> = maya_b_base_y - (maya_b_height * (s - 1)) + (combat_intro_maya_b_arc_y * turn)

		combat_pose.write(target.monster, monster_hidden_x, monster_hidden_y, monster_start_scale, monster_start_scale, params.enemy_weight, params.camera_y)

		target.monster.visible = false

		combat_pose.write(target.maya_a, maya_a_start_x, maya_a_hidden_y, maya_a_start_scale, maya_a_start_scale, params.hero_weight, params.camera_y)

		target.maya_a.visible = false

		target.maya_b:set_presentation_affine(s, 0, 0, s, x - target.maya_b.attachment_ox, y - target.maya_b.attachment_oy)

		target.maya_b.visible = true
		return
	end

	local i<const> = frame_index - (combat_intro_maya_b_frames)
	local u<const> = i / (combat_intro_reveal_frames - 1)
	local eased<const> = smoothstep(u)
	local whoosh<const> = ease_out_back(eased)
	local move<const> = eased + ((whoosh - eased) * combat_intro_whoosh_strength)
	local turn<const> = arc01(u)

	local monster_scale<const> = monster_start_scale + (1 - monster_start_scale) * eased
	local monster_ox<const> = (monster_width * (monster_scale - 1)) / 2
	local monster_oy<const> = (monster_height * (monster_scale - 1)) / 2
	local monster_x<const> = monster_start_x + (monster_base_x - monster_start_x) * move + (combat_intro_monster_arc_x * turn) - monster_ox
	local monster_y<const> = monster_start_y + (monster_base_y - monster_start_y) * eased + (combat_intro_monster_arc_y * turn) - monster_oy

	local maya_a_scale<const> = maya_a_start_scale + (1 - maya_a_start_scale) * eased
	local maya_a_x<const> = maya_a_start_x + (maya_a_base_x - maya_a_start_x) * move + (combat_intro_maya_a_arc_x * turn)
	local maya_a_y<const> = maya_a_base_y - (maya_a_height * (maya_a_scale - 1)) + (combat_intro_maya_a_arc_y * turn)

	combat_pose.write(target.monster, monster_x, monster_y, monster_scale, monster_scale, params.enemy_weight, params.camera_y)

	target.monster.visible = true

	combat_pose.write(target.maya_a, maya_a_x, maya_a_y, maya_a_scale, maya_a_scale, params.hero_weight, params.camera_y)

	target.maya_a.visible = true

	target.maya_b:set_presentation_affine(1, 0, 0, 1, maya_b_base_x - target.maya_b.attachment_ox, maya_b_base_y - target.maya_b.attachment_oy)

	target.maya_b.visible = false

end

function builders.apply_combat_dodge_frames(target, frame_index, params)
	local dir<const> = params.dir
	local base_x<const> = params.base_x
	local move_frames<const> = dodge_move_frames
	local move_end<const> = dodge_move_end
	local peak_end<const> = dodge_peak_end

	local offset = 0
	local scale_x = 1
	local scale_y = 1
	if frame_index < combat_dodge_anticipation_frames then
		local u<const> = frame_index / (combat_dodge_anticipation_frames - 1)
		offset = -combat_monster_dodge_distance * 0.2 * smoothstep(u) * dir
		local t<const> = smoothstep(u)
		scale_x = 1 + (combat_dodge_anticipation_scale_x * t)
		scale_y = 1 + (combat_dodge_anticipation_scale_y * t)
	elseif frame_index < move_end then
		local u<const> = (frame_index - combat_dodge_anticipation_frames) / (move_frames - 1)
		offset = combat_monster_dodge_distance * ease_out_quad(u) * dir
		local t<const> = ease_out_quad(u)
		scale_x = 1 + (combat_dodge_move_scale_x * t)
		scale_y = 1 + (combat_dodge_move_scale_y * t)
	elseif frame_index < peak_end then
		offset = combat_monster_dodge_distance * dir
		scale_x = 1 + combat_dodge_move_scale_x
		scale_y = 1 + combat_dodge_move_scale_y
	else
		local u<const> = (frame_index - peak_end) / (combat_dodge_recover_frames - 1)
		local t<const> = 1 - ease_in_quad(u)
		offset = combat_monster_dodge_distance * t * dir
		scale_x = 1 + (combat_dodge_move_scale_x * t)
		scale_y = 1 + (combat_dodge_move_scale_y * t)
	end
	combat_pose.write(target, base_x + offset, params.base_y, scale_x, scale_y, params.enemy_weight, params.camera_y)

end

function builders.apply_combat_exchange_frames(target, frame_index, params)
	local monster_base_x<const> = params.monster_base_x
	local monster_base_y<const> = params.monster_base_y
	local maya_base_x<const> = params.maya_base_x
	local maya_base_y<const> = params.maya_base_y
	local maya_recover_frames<const> = params.maya_recover_frames
	local maya_bob_amp<const> = params.maya_bob_amp
	local maya_bob_period_frames<const> = params.maya_bob_period_frames
	local maya_react_scale_x<const> = params.maya_react_scale_x
	local maya_react_scale_y<const> = params.maya_react_scale_y
	local maya_impact_scale_x<const> = params.maya_impact_scale_x
	local maya_impact_scale_y<const> = params.maya_impact_scale_y
	local recover_frames<const> = params.recover_frames
	local lunge_end<const> = exchange_lunge_end
	local hitstop_end<const> = exchange_hitstop_end
	local impact_start<const> = lunge_end
	local impact_end<const> = params.impact_end
	local impact_frames<const> = params.impact_frames
	local maya_hold_end<const> = params.maya_hold_end
	local maya_recover_end<const> = params.maya_recover_end

	local i<const> = frame_index
	local lunge = 0
	if i < combat_exchange_anticipate_frames then
		local u<const> = i / (combat_exchange_anticipate_frames - 1)
		lunge = -0.10 * smoothstep(u)
	elseif i < lunge_end then
		local u<const> = (i - combat_exchange_anticipate_frames) / (combat_exchange_lunge_frames - 1)
		lunge = ease_in_out_quad(u)
	elseif i < hitstop_end then
		lunge = 1.0
	else
		local u<const> = (i - hitstop_end) / (recover_frames - 1)
		lunge = 1.0 - ease_in_quad(u)
	end

	local impact_u = 0
	if i >= impact_start and i <= impact_end then
		local ru<const> = (i - impact_start) / (impact_frames - 1)
		impact_u = arc01(impact_frames <= 6 and smoothstep(smoothstep(ru)) or smoothstep(ru))
	end

	local maya_u = 0
	if i >= impact_start and i <= impact_end then
		local ru<const> = (i - impact_start) / (impact_frames - 1)
		maya_u = (impact_frames <= 6 and smoothstep(smoothstep(ru)) or smoothstep(ru))
	elseif i > impact_end and i <= maya_hold_end then
		maya_u = 1
	elseif i > maya_hold_end and i <= maya_recover_end and maya_recover_frames > 0 then
		local ru<const> = (i - maya_hold_end) / (maya_recover_frames - 1)
		maya_u = 1 - (maya_recover_frames <= 6 and smoothstep(smoothstep(ru)) or smoothstep(ru))
	end

	local forward = lunge
	if forward < 0 then
		forward = 0
	end

	local monster_x = monster_base_x - (combat_exchange_lunge_distance * forward)
	local monster_y = monster_base_y + (combat_exchange_lunge_lift * forward)
	if impact_u > 0 then
		monster_x = monster_x - (combat_exchange_lunge_distance * combat_exchange_lunge_punch * impact_u)
		monster_y = monster_y + (combat_exchange_lunge_lift * combat_exchange_lunge_punch * impact_u)
	end

	local s = 1
	if lunge < 0 then
		s = 1 - (0.04 * (-lunge))
	else
		s = 1 + ((combat_exchange_lunge_scale - 1) * forward)
	end

	local maya_x = maya_base_x
	local maya_y = maya_base_y
	local maya_scale_x = 1
	local maya_scale_y = 1
	local maya_flash = false
	local overlay_strength = 0
	local bob = 0

	if maya_u > 0 then
		maya_x = maya_x + (params.maya_offset_x * maya_u)
		maya_y = maya_y + (params.maya_offset_y * maya_u)
		maya_scale_x = 1 + (maya_react_scale_x * maya_u)
		maya_scale_y = 1 + (maya_react_scale_y * maya_u)
		local bob_u<const> = smoothstep(pingpong01((i - impact_start) / maya_bob_period_frames))
		bob = (bob_u - 0.5) * 2 * maya_bob_amp
	end

	if impact_u > 0 then
		if params.squash then
			maya_scale_x = maya_scale_x + (maya_impact_scale_x * impact_u)
			maya_scale_y = maya_scale_y + (maya_impact_scale_y * impact_u)
		end
		if params.flash then
			local flash_index<const> = i - impact_start
			if (flash_index % 2) == 1 then
				maya_flash = true
			end
		end
		local cam_dx<const> = round_number(shake_signed(i * 19 + 5) * params.cam_shake_x * impact_u)
		local cam_dy<const> = round_number(shake_signed(i * 23 + 11) * params.cam_shake_y * impact_u)
		monster_x = monster_x + cam_dx
		monster_y = monster_y + cam_dy
		maya_x = maya_x + cam_dx
		maya_y = maya_y + cam_dy
		overlay_strength = params.overlay_strength * impact_u
	end
	maya_y = maya_y + bob

	local overlay_blend_color = 0
	if overlay_strength > 0 then
		local level<const> = round_number(overlay_strength * 255)
		overlay_blend_color = color.mix_rgb_with_alpha(p3_black_color, params.flash_color, level, 1)
	end

	combat_pose.write(target.monster, monster_x, monster_y, s, s, params.enemy_weight, params.camera_y)

	target.monster.color = p3_white_color

	combat_pose.write(target.maya_a, maya_x, maya_y, maya_scale_x, maya_scale_y, params.hero_weight, params.camera_y)

	target.maya_a.color = maya_flash and params.flash_color or p3_white_color

	target.overlay.color = 0

	target.overlay.blend_color = overlay_blend_color

end

function builders.apply_combat_hit_frames(target, frame_index, params)
	local base_x<const> = params.base_x
	local base_y<const> = params.base_y
	local monster_width<const> = params.monster_width
	local monster_height<const> = params.monster_height
	local move_frames<const> = hit_move_frames
	local peak_start<const> = hit_peak_start
	local recover_start<const> = hit_recover_start
	local slash_end<const> = hit_slash_end
	local path_nx<const>, path_ny<const> = params.path_nx, params.path_ny
	local base_length<const>, base_thickness<const> = params.slash_length, params.slash_thickness

	local kick = 0
	if frame_index >= combat_hit_stop_frames and frame_index < peak_start then
		local u<const> = (frame_index - combat_hit_stop_frames) / (move_frames - 1)
		kick = ease_out_quad(u)
	elseif frame_index >= peak_start and frame_index < recover_start then
		kick = 1
	elseif frame_index >= recover_start then
		local u<const> = (frame_index - recover_start) / (combat_hit_recover_frames - 1)
		kick = 1 - ease_in_quad(u)
	end

	local dx = combat_hit_knockback_x * kick
	local dy = combat_hit_knockback_y * kick
	if frame_index >= combat_hit_stop_frames and frame_index < (combat_hit_stop_frames + combat_hit_shake_frames) then
		local k<const> = frame_index - combat_hit_stop_frames
		local intensity<const> = (combat_hit_shake_frames - k) / combat_hit_shake_frames
		dx = dx + round_number(shake_signed(frame_index * 31 + 7) * combat_hit_shake_x * intensity)
		dy = dy + round_number(shake_signed(frame_index * 37 + 11) * combat_hit_shake_y * intensity)
	end

	local monster_x<const> = base_x + dx
	local monster_y<const> = base_y + dy
	local monster_scale_x<const> = 1 + (combat_hit_scale_x * kick)
	local monster_scale_y<const> = 1 + (combat_hit_scale_y * kick)

	local monster_flash = false
	if frame_index >= combat_hit_stop_frames and frame_index < recover_start then
		local flash_index<const> = frame_index - combat_hit_stop_frames
		if (flash_index % 2) == 1 then
			monster_flash = true
		end
	end

	local slash_active = frame_index >= combat_hit_stop_frames and frame_index <= slash_end
	local slash_x0, slash_y0, slash_x1, slash_y1 = 0, 0, 0, 0
	local slash_thickness = 0
	local slash_color<const> = p3_white_color
	if slash_active then
		local u<const> = (frame_index - combat_hit_stop_frames) / (slash_end - combat_hit_stop_frames)
		local arc<const> = arc01(u)
		local center_x<const> = (monster_width * (combat_hit_slash_path_start_x_ratio + ((combat_hit_slash_path_end_x_ratio - combat_hit_slash_path_start_x_ratio) * u)))
		local center_y<const> = (monster_height * (combat_hit_slash_path_start_y_ratio + ((combat_hit_slash_path_end_y_ratio - combat_hit_slash_path_start_y_ratio) * u)))
		local scale<const> = 1 + ((combat_hit_slash_peak_scale - 1) * arc)
		local half<const> = (base_length * scale) / 2
		local x0<const> = center_x - (path_nx * half)
		local y0<const> = center_y - (path_ny * half)
		local x1<const> = center_x + (path_nx * half)
		local y1<const> = center_y + (path_ny * half)
		slash_x0, slash_y0, slash_x1, slash_y1 = x0, y0, x1, y1
		slash_thickness = base_thickness * (combat_hit_slash_taper_floor + ((1 - combat_hit_slash_taper_floor) * arc)) * (combat_hit_slash_visibility * arc)
		slash_active = slash_thickness > 0
	end

	combat_pose.write(target.monster, monster_x, monster_y, monster_scale_x, monster_scale_y, params.enemy_weight, params.camera_y)

	target.monster.color = monster_flash and 0xffff3333 or p3_white_color

	target.slash_frame.slash_active = slash_active

	target.slash_frame.slash_x0, target.slash_frame.slash_y0 = slash_x0, slash_y0
	target.slash_frame.slash_x1, target.slash_frame.slash_y1 = slash_x1, slash_y1

	target.slash_frame.slash_thickness = slash_thickness

	target.slash_frame.slash_color = slash_color

end

function builders.apply_combat_results_fade_in_frames(target, frame_index, params)
	local maya_start_x<const> = params.maya_start_x
	local maya_target_x<const> = params.maya_target_x
	local text_start_x<const> = params.text_start_x
	local text_target_x<const> = params.text_target_x

	local u<const> = frame_index / (combat_results_fade_in_frames - 1)
	local a<const> = smoothstep(u)
	local level<const> = round_number(a * 255)
	local brightness<const> = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)
	target.bg.color = color.mix_rgb_with_alpha(p3_black_color, combat_results_bg_visible_color, level, 1)
	target.maya_b:set_presentation_origin(maya_start_x + (maya_target_x - maya_start_x) * a - target.maya_b.attachment_ox, target.maya_b.presentation_oy)
	target.maya_b.color = brightness
	target.results.text_component:set_presentation_origin(text_start_x + (text_target_x - text_start_x) * a, target.results.text_component.presentation_oy)
	target.results.text_component.color = brightness

end

function builders.apply_combat_results_fade_out_frames(target, frame_index, params)

	local u<const> = frame_index / (combat_results_fade_out_frames - 1)
	local a<const> = 1 - smoothstep(u)
	local level<const> = round_number(a * 255)
	local brightness<const> = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)
	target.bg.color = color.mix_rgb_with_alpha(p3_black_color, combat_results_bg_visible_color, level, 1)
	target.maya_b.color = brightness
	target.results.text_component.color = brightness

end

function builders.apply_combat_exit_fade_in_frames(target, frame_index, params)

	local u<const> = frame_index / (combat_exit_fade_in_frames - 1)
	local c<const> = smoothstep(u)
	local level<const> = round_number(c * 255)
	target.color = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)

end

function builders.apply_transition_frame(target, frame_index, params)
	local fade_out_frames<const> = params.fade_out_frames
	local fade_in_frames<const> = params.fade_in_frames
	local fade_in_start<const> = params.fade_in_start
	local skip_fade<const> = params.skip_fade
	local palette<const> = params.palette
	local panels<const> = params.panels
	local accent_panel<const> = params.accent
	local center_x<const> = params.center_x
	local start_x<const> = params.start_x
	local end_x<const> = params.end_x
	local text_out_start<const> = transition_text_in_frames + transition_text_hold_frames
	local text_out_end<const> = text_out_start + transition_text_out_frames
	local base<const> = palette.overlay
	local overlay_fade_out_start<const> = fade_in_start - transition_panel_out_frames
	if skip_fade and frame_index == 0 then
		return
	end

	local overlay_color = base
	local overlay_blend_color = 0
	local background_color = p3_black_color
	if not skip_fade then
		if frame_index < fade_out_frames then
			local u<const> = frame_index / (fade_out_frames - 1)
			local level<const> = round_number(smoothstep(u) * 255)
			overlay_color = 0
			overlay_blend_color = level == 0 and 0 or color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)
			background_color = p3_white_color
		elseif frame_index >= fade_in_start then
			local u<const> = (frame_index - fade_in_start) / (fade_in_frames - 1)
			local level<const> = round_number(smoothstep(u) * 255)
			overlay_color = 0
			background_color = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)
		end
	end
	if frame_index >= overlay_fade_out_start and frame_index < fade_in_start then
		local u<const> = (frame_index - overlay_fade_out_start) / (transition_panel_out_frames - 1)
		local level<const> = round_number(smoothstep(u) * 255)
		overlay_color = color.mix_rgb_with_alpha(base, p3_black_color, level, 1)
	end

	target.bg.color = background_color
	target.overlay.color = overlay_color
	target.overlay.blend_color = overlay_blend_color
	for i = 1, #panels do
		local panel<const> = panels[i]
		local visual<const> = target.panels[i]
		local x<const> , y<const> , a<const> = panel_motion(frame_index, panel, transition_panel_in_frames, transition_panel_hold_frames, transition_panel_out_frames)
		visual.visible = a > 0
		visual:set_presentation_origin(x - visual.attachment_ox, y - visual.attachment_oy)
		visual.color = a > 0 and panel.color or 0
	end

	local ax<const> , ay<const> , aa<const> = panel_motion(frame_index, accent_panel, transition_accent_in_frames, transition_accent_hold_frames, transition_accent_out_frames)
	target.accent.visible = aa > 0
	target.accent:set_presentation_origin(ax - target.accent.attachment_ox, ay - target.accent.attachment_oy)
	target.accent.color = aa > 0 and accent_panel.color or 0

	local text_x = end_x
	if frame_index < transition_text_in_frames then
		local u<const> = frame_index / (transition_text_in_frames - 1)
		text_x = start_x + (center_x - start_x) * smoothstep(u)
	elseif frame_index < text_out_start then
		text_x = center_x
	elseif frame_index < text_out_end then
		local out_index<const> = frame_index - text_out_start
		local u<const> = out_index / (transition_text_out_frames - 1)
		text_x = center_x + (end_x - center_x) * smoothstep(u)
	end
	target.text.text_component:set_presentation_origin(text_x, target.text.text_component.presentation_oy)
end

function builders.apply_transition_fade_in_frames(target, frame_index, params)

	local u<const> = frame_index / (overgang_fade_in_frames - 1)
	local level<const> = round_number(smoothstep(u) * 255)
	target.color = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)

end

function builders.apply_fade_frames(target, frame_index, params)
	local hold_black<const> = params.hold_black
	local fade_in_start<const> = fade_out_frames + fade_hold_frames

	local blend_level
	local background_color = p3_white_color
	if frame_index < fade_out_frames then
		blend_level = round_number(smoothstep(frame_index / (fade_out_frames - 1)) * 255)
	else
		if hold_black or frame_index < fade_in_start then
			blend_level = 255
		else
			blend_level = 0
			local level<const> = round_number(smoothstep((frame_index - fade_in_start) / (fade_in_frames - 1)) * 255)
			background_color = color.mix_rgb_with_alpha(p3_black_color, p3_white_color, level, 1)
		end
	end

	target.bg.color = background_color

	target.overlay.color = 0

	target.overlay.blend_color = blend_level == 0 and 0 or color.mix_rgb_with_alpha(p3_black_color, p3_white_color, blend_level, 1)

end

return builders
