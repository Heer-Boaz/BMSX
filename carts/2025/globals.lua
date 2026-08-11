screen_width = 320
screen_height = 240

-- Transition/overgang timing is authored as a ROM data asset and read back via
-- the build/link `bmsx/assets` symbols: the addresses inline to constants at this
-- use site and `bin.decode` reads the packed bytes (no PICO-style runtime lookup).
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
local transition_config<const> = bin.decode(assets.data_transition_config_addr, 'transition_config')

overgang_timeline_id = transition_config.overgang_timeline_id
overgang_in_frames = transition_config.overgang_in_frames
overgang_hold_frames = transition_config.overgang_hold_frames
overgang_out_frames = transition_config.overgang_out_frames
overgang_frame_count = overgang_in_frames + overgang_hold_frames + overgang_out_frames
overgang_frame_duration = transition_config.overgang_frame_duration
overgang_fade_out_frames = transition_config.overgang_fade_out_frames
overgang_fade_in_frames = transition_config.overgang_fade_in_frames
overgang_post_fade_in_timeline_id = transition_config.overgang_post_fade_in_timeline_id
transition_panel_in_frames = transition_config.transition_panel_in_frames
transition_panel_hold_frames = transition_config.transition_panel_hold_frames
transition_panel_out_frames = transition_config.transition_panel_out_frames
transition_panel_gap_frames = transition_config.transition_panel_gap_frames
transition_accent_in_frames = transition_config.transition_accent_in_frames
transition_accent_hold_frames = transition_config.transition_accent_hold_frames
transition_accent_out_frames = transition_config.transition_accent_out_frames
transition_text_in_frames = transition_config.transition_text_in_frames
transition_text_hold_frames = transition_config.transition_text_hold_frames
transition_text_out_frames = transition_config.transition_text_out_frames

combat_fade_timeline_id = 'combat_fade'
combat_fade_out_frames = 10
combat_fade_hold_frames = 4
combat_fade_in_frames = 10
combat_fade_frame_count = combat_fade_out_frames + combat_fade_hold_frames + combat_fade_in_frames
combat_fade_frame_duration = 20
combat_intro_timeline_id = 'combat_intro'
combat_intro_maya_b_frames = 14
combat_intro_reveal_frames = 26
combat_intro_frame_duration = 24
combat_intro_hold_frames = 3
combat_intro_whoosh_strength = 0.15
combat_intro_maya_b_start_scale = 1.08
combat_intro_maya_b_end_scale = 0.9
combat_intro_maya_a_scale_ratio = 0.6
combat_intro_monster_start_y_offset = 32
combat_intro_monster_arc_x = 24
combat_intro_monster_arc_y = 8
combat_intro_maya_a_arc_x = -12
combat_intro_maya_a_arc_y = -4
combat_intro_maya_b_arc_y = -6
combat_focus_timeline_id = 'combat_focus'
combat_hover_timeline_id = 'combat_hover'
combat_focus_zoom_frames = 8
	combat_focus_vanish_frames = 12
	combat_focus_frame_duration = 24
	combat_focus_zoom_scale = 1.22
	combat_focus_vanish_scale_x = 2.0
	combat_focus_vanish_scale_y = 0.08
	combat_focus_zoom_arc_x = 10
	combat_focus_zoom_arc_y = -6
	combat_focus_vanish_arc_x = -6
	combat_focus_vanish_arc_y = 0
	combat_focus_vanish_lift = 6

fade_timeline_id = 'fade'
fade_out_frames = 18
fade_hold_frames = 12
fade_in_frames = 18
fade_frame_count = fade_out_frames + fade_hold_frames + fade_in_frames
fade_frame_duration = 20

combat_hit_timeline_id = 'combat_hit'
combat_hit_frame_count = 16
combat_hit_frame_duration = 24
combat_hit_stop_frames = 2
combat_hit_peak_frames = 2
combat_hit_recover_frames = 4
combat_hit_knockback_x = 22
combat_hit_knockback_y = -12
combat_hit_shake_frames = 3
combat_hit_shake_x = 9
combat_hit_shake_y = 7
combat_hit_scale_x = 0.12
combat_hit_scale_y = -0.08
combat_hit_slash_path_start_x_ratio = 0.18
combat_hit_slash_path_start_y_ratio = 0.28
combat_hit_slash_path_end_x_ratio = 0.82
combat_hit_slash_path_end_y_ratio = 0.7
combat_hit_slash_length_ratio = 0.9
combat_hit_slash_thickness_ratio = 0.06
combat_hit_slash_peak_scale = 1.45
combat_hit_slash_visibility = 0.9
combat_hit_slash_taper_floor = 0.3
combat_hit_slash_z = 650
director_visual_z = 850
combat_maya_z = 300
combat_results_maya_z = 900

combat_dodge_timeline_id = 'combat_dodge'
combat_dodge_frame_count = 22
combat_dodge_frame_duration = 24
combat_dodge_anticipation_frames = 4
combat_dodge_peak_frames = 2
combat_dodge_recover_frames = 4
combat_dodge_anticipation_scale_x = -0.04
combat_dodge_anticipation_scale_y = 0.03
combat_dodge_move_scale_x = 0.07
combat_dodge_move_scale_y = -0.05

combat_exchange_hit_timeline_id = 'combat_exchange_hit'
combat_exchange_hit_frame_count = 22
combat_exchange_hit_frame_duration = 24
combat_exchange_miss_timeline_id = 'combat_exchange_miss'
combat_exchange_miss_frame_count = 28
combat_exchange_miss_frame_duration = 24
combat_exchange_anticipate_frames = 3
combat_exchange_lunge_frames = 6
combat_exchange_hitstop_frames = 3
combat_exchange_lunge_distance = 160
combat_exchange_lunge_lift = 26
combat_exchange_lunge_scale = 1.42
combat_exchange_lunge_punch = 0.25
combat_exchange_hit_recoil_distance = 28
combat_exchange_hit_recoil_lift = 36
combat_exchange_hit_recoil_hold_frames = 3
combat_exchange_hit_recoil_recover_frames = 5
combat_exchange_hit_scale_x = 0.16
combat_exchange_hit_scale_y = -0.12
combat_exchange_hit_impact_scale_x = 0.24
combat_exchange_hit_impact_scale_y = -0.2
combat_exchange_hit_shake_x = 20
combat_exchange_hit_shake_y = 16
combat_exchange_hit_overlay_strength = 0.35
combat_exchange_miss_dodge_distance = -54
combat_exchange_miss_dodge_lift = 4
combat_exchange_miss_dodge_hold_frames = 4
combat_exchange_miss_dodge_recover_frames = 7
combat_exchange_miss_dodge_bob_amp = 5
combat_exchange_miss_dodge_bob_period_frames = 6
combat_exchange_miss_dodge_scale_x = -0.05
combat_exchange_miss_dodge_scale_y = 0.08

combat_all_out_timeline_id = 'combat_all_out'
combat_all_out_frame_count = 150
combat_all_out_frame_duration = 1
combat_all_out_pulse_period_frames = 16
combat_all_out_pulse_amp = 0.14

combat_results_fade_out_timeline_id = 'combat_results_fade_out'
combat_results_fade_out_frames = 18
combat_results_fade_out_frame_duration = 32

combat_exit_fade_in_timeline_id = 'combat_exit_fade_in'
combat_exit_fade_in_frames = 18
combat_exit_fade_in_frame_duration = 32

combat_results_fade_in_timeline_id = 'combat_results_fade_in'
combat_results_fade_in_frames = 18
combat_results_fade_in_frame_duration = 32

combat_monster_hover_period_seconds = 1.8
combat_monster_hover_amp = 3
combat_monster_dodge_distance = 64
combat_parallax_momentum_step = 1
combat_parallax_momentum_limit_steps = 5
combat_parallax_scale_delta = 245 / 65536

p3_blue_color = 0xff1247cc
p3_cyan_color = 0xff52dbfa
p3_ink_color = 0xff00183e
p3_white_color = 0xffffffff
p3_black_color = 0xff000000

p3_transition_palette_dialogue = {
	overlay = p3_ink_color,
	panel_primary = p3_blue_color,
	panel_secondary = p3_black_color,
	accent = p3_cyan_color,
}
p3_transition_palette_combat = {
	overlay = p3_black_color,
	panel_primary = p3_black_color,
	panel_secondary = p3_blue_color,
	accent = p3_cyan_color,
}
p3_transition_palette_ending = {
	overlay = p3_blue_color,
	panel_primary = p3_blue_color,
	panel_secondary = p3_ink_color,
	accent = p3_cyan_color,
}
p3_transition_palette_choice = p3_transition_palette_dialogue

combat_results_bg_visible_color = p3_blue_color

function clear_texts(texts)
	for i = 1, #texts do
		texts[i]:clear_text()
	end
end

function apply_background(background, id)
	if id == nil then
		return
	end
	background.surface_component:set_imgid(id)
end

function show_background(background, id)
	if id ~= nil then
		background.surface_component:set_imgid(id)
	end
	background.visible = true
	background.surface_component.color = p3_white_color
	return background
end

function reset_text_colors(owner)
	owner.text_main.text_component.color = p3_white_color
	owner.text_choice.text_component.color = p3_white_color
	owner.text_prompt.text_component.color = p3_white_color
	owner.text_transition.text_component.color = p3_ink_color
	owner.text_results.text_component.color = p3_white_color
end

function hide_transition_layers(transition_visual)
	local overlay<const> = transition_visual.overlay
	overlay.visible = false
	overlay.color = 0
	overlay.blend_color = 0
	for i = 1, #transition_visual.panels do
		local panel<const> = transition_visual.panels[i]
		panel.visible = false
		panel.color = 0
	end
	local accent<const> = transition_visual.accent
	accent.visible = false
	accent.color = 0
end

function hide_combat_visuals(visuals)
	for i = 1, #visuals do
		visuals[i].visible = false
	end
end
