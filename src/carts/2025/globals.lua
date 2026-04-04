local bg_id<const> = 'p3.bg'
local combat_monster_id<const> = 'p3.combat.monster'
local combat_maya_a_id<const> = 'p3.combat.maya_a'
local combat_maya_b_id<const> = 'p3.combat.maya_b'
local combat_all_out_id<const> = 'p3.combat.all_out'
local text_main_id<const> = 'p3.text.main'
local text_choice_id<const> = 'p3.text.choice'
local text_prompt_id<const> = 'p3.text.prompt'
local text_transition_id<const> = 'p3.text.transition'
local text_results_id<const> = 'p3.text.results'
local text_ids_all<const> = { text_main_id, text_choice_id, text_prompt_id, text_transition_id, text_results_id }
local text_ids_core<const> = { text_main_id, text_choice_id, text_prompt_id, text_transition_id }
local text_ids_choice_prompt<const> = { text_choice_id, text_prompt_id }
local text_ids_transition_results<const> = { text_transition_id, text_results_id }

local director_instance_id<const> = 'p3.director'
local combat_director_def_id<const> = 'p3.combat.director'
local combat_director_instance_id<const> = 'p3.combat.director'
local combat_director_fsm_id<const> = 'p3.combat.director.fsm'

overgang_timeline_id = 'overgang'
overgang_in_frames = 24
overgang_hold_frames = 48
overgang_out_frames = 24
overgang_frame_count = overgang_in_frames + overgang_hold_frames + overgang_out_frames
overgang_ticks_per_frame = 32
overgang_fade_out_frames = 18
overgang_fade_in_frames = 18
overgang_post_fade_in_timeline_id = 'overgang_post_fade_in'
transition_panel_in_frames = 6
transition_panel_hold_frames = 10
transition_panel_out_frames = 6
transition_panel_gap_frames = 4
transition_accent_in_frames = 4
transition_accent_hold_frames = 8
transition_accent_out_frames = 4
transition_text_in_frames = 6
transition_text_hold_frames = 32
transition_text_out_frames = 5
transition_flash_frames = 2
transition_flash_mix = 0.35

combat_fade_timeline_id = 'combat_fade'
combat_fade_out_frames = 10
combat_fade_hold_frames = 4
combat_fade_in_frames = 10
combat_fade_frame_count = combat_fade_out_frames + combat_fade_hold_frames + combat_fade_in_frames
combat_fade_ticks_per_frame = 32
combat_intro_timeline_id = 'combat_intro'
combat_intro_maya_b_frames = 14
combat_intro_reveal_frames = 26
combat_intro_ticks_per_frame = 24
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
combat_parallax_timeline_id = 'combat_parallax'
combat_focus_zoom_frames = 8
	combat_focus_vanish_frames = 12
	combat_focus_ticks_per_frame = 24
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
fade_ticks_per_frame = 32

combat_hit_timeline_id = 'combat_hit'
combat_hit_frame_count = 16
combat_hit_ticks_per_frame = 24
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
combat_hit_slash_alpha = 0.9
combat_hit_slash_taper_floor = 0.3
combat_hit_slash_z = 650

combat_dodge_timeline_id = 'combat_dodge'
combat_dodge_frame_count = 22
combat_dodge_ticks_per_frame = 24
combat_dodge_anticipation_frames = 4
combat_dodge_peak_frames = 2
combat_dodge_recover_frames = 4
combat_dodge_anticipation_scale_x = -0.04
combat_dodge_anticipation_scale_y = 0.03
combat_dodge_move_scale_x = 0.07
combat_dodge_move_scale_y = -0.05

combat_exchange_hit_timeline_id = 'combat_exchange_hit'
combat_exchange_hit_frame_count = 22
combat_exchange_hit_ticks_per_frame = 24
combat_exchange_miss_timeline_id = 'combat_exchange_miss'
combat_exchange_miss_frame_count = 28
combat_exchange_miss_ticks_per_frame = 24
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
combat_exchange_hit_overlay_alpha = 0.35
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
combat_all_out_ticks_per_frame = 1
combat_all_out_pulse_period_frames = 16
combat_all_out_pulse_amp = 0.14

combat_results_fade_out_timeline_id = 'combat_results_fade_out'
combat_results_fade_out_frames = 18
combat_results_fade_out_ticks_per_frame = 32

combat_exit_fade_in_timeline_id = 'combat_exit_fade_in'
combat_exit_fade_in_frames = 18
combat_exit_fade_in_ticks_per_frame = 32

combat_results_fade_in_timeline_id = 'combat_results_fade_in'
combat_results_fade_in_frames = 18
combat_results_fade_in_ticks_per_frame = 32

combat_monster_hover_period_seconds = 1.8
combat_monster_hover_amp = 3
combat_monster_dodge_distance = 64
combat_parallax_vy_base = 1.2
combat_parallax_vy_momentum = 0.6
combat_parallax_scale_base = 1
combat_parallax_scale_momentum = 0.015
combat_parallax_impact_amp = 0.03
combat_parallax_momentum_step = 0.2
combat_parallax_impact_duration_seconds = 1.2
combat_parallax_bias_base = 2.2
combat_parallax_bias_momentum = 1.0
combat_parallax_parallax_strength = 0.5
combat_parallax_scale_strength = 0.25
combat_parallax_flip_strength = 0.5
combat_parallax_flip_window_seconds = 0.6

p3_blue_r = 0.07
p3_blue_g = 0.28
p3_blue_b = 0.8
p3_cyan_r = 0.32
p3_cyan_g = 0.86
p3_cyan_b = 0.98
p3_ink_r = 0.02
p3_ink_g = 0.05
p3_ink_b = 0.12
p3_black_r = 0
p3_black_g = 0
p3_black_b = 0

p3_transition_palette_dialogue = {
	overlay = { r = p3_ink_r, g = p3_ink_g, b = p3_ink_b },
	panel_primary = { r = p3_blue_r, g = p3_blue_g, b = p3_blue_b },
	panel_secondary = { r = p3_black_r, g = p3_black_g, b = p3_black_b },
	accent = { r = p3_cyan_r, g = p3_cyan_g, b = p3_cyan_b },
}
p3_transition_palette_combat = {
	overlay = { r = p3_black_r, g = p3_black_g, b = p3_black_b },
	panel_primary = { r = p3_black_r, g = p3_black_g, b = p3_black_b },
	panel_secondary = { r = p3_blue_r, g = p3_blue_g, b = p3_blue_b },
	accent = { r = p3_cyan_r, g = p3_cyan_g, b = p3_cyan_b },
}
p3_transition_palette_ending = {
	overlay = { r = p3_blue_r, g = p3_blue_g, b = p3_blue_b },
	panel_primary = { r = p3_blue_r, g = p3_blue_g, b = p3_blue_b },
	panel_secondary = { r = p3_ink_r, g = p3_ink_g, b = p3_ink_b },
	accent = { r = p3_cyan_r, g = p3_cyan_g, b = p3_cyan_b },
}
p3_transition_palette_choice = p3_transition_palette_dialogue

combat_results_bg_r = p3_blue_r
combat_results_bg_g = p3_blue_g
combat_results_bg_b = p3_blue_b
combat_results_bg_a = 0.85

local clear_texts<const> = function(text_ids)
	for i = 1, #text_ids do
		oget(text_ids[i]):clear_text()
	end
end

local apply_background<const> = function(id)
	if id == nil then
		return
	end
	local bg<const> = oget(bg_id)
	bg:gfx(id)
end

local show_background<const> = function(id)
	local bg<const> = oget(bg_id)
	if id ~= nil then
		bg:gfx(id)
	end
	bg.visible = true
	local color<const> = bg.sprite_component.colorize
	color.r = 1
	color.g = 1
	color.b = 1
	color.a = 1
	return bg
end

local reset_text_colors<const> = function()
	local main_color<const> = oget(text_main_id).text_color
	main_color.r = 1
	main_color.g = 1
	main_color.b = 1
	main_color.a = 1
	local choice_color<const> = oget(text_choice_id).text_color
	choice_color.r = 1
	choice_color.g = 1
	choice_color.b = 1
	choice_color.a = 1
	local prompt_color<const> = oget(text_prompt_id).text_color
	prompt_color.r = 1
	prompt_color.g = 1
	prompt_color.b = 1
	prompt_color.a = 1
	local transition_color<const> = oget(text_transition_id).text_color
	transition_color.r = 1
	transition_color.g = 1
	transition_color.b = 1
	transition_color.a = 1
	local results_color<const> = oget(text_results_id).text_color
	results_color.r = 1
	results_color.g = 1
	results_color.b = 1
	results_color.a = 1
end

local hide_transition_layers<const> = function()
	local director<const> = oget(director_instance_id)
	local overlay<const> = director.transition_visual.overlay
	overlay.visible = false
	overlay.r = 0
	overlay.g = 0
	overlay.b = 0
	overlay.a = 0
	for i = 1, #director.transition_visual.panels do
		local panel<const> = director.transition_visual.panels[i]
		panel.visible = false
		panel.r = 0
		panel.g = 0
		panel.b = 0
		panel.a = 0
	end
	local accent<const> = director.transition_visual.accent
	accent.visible = false
	accent.r = 0
	accent.g = 0
	accent.b = 0
	accent.a = 0
end

local hide_combat_sprites<const> = function()
	oget(combat_monster_id).visible = false
	oget(combat_maya_a_id).visible = false
	oget(combat_maya_b_id).visible = false
	oget(combat_all_out_id).visible = false
end

return {
	bg_id = bg_id,
	combat_monster_id = combat_monster_id,
	combat_maya_a_id = combat_maya_a_id,
	combat_maya_b_id = combat_maya_b_id,
	combat_all_out_id = combat_all_out_id,
	text_main_id = text_main_id,
	text_choice_id = text_choice_id,
	text_prompt_id = text_prompt_id,
	text_transition_id = text_transition_id,
	text_results_id = text_results_id,
	text_ids_all = text_ids_all,
	text_ids_core = text_ids_core,
	text_ids_choice_prompt = text_ids_choice_prompt,
	text_ids_transition_results = text_ids_transition_results,
	director_instance_id = director_instance_id,
	combat_director_def_id = combat_director_def_id,
	combat_director_instance_id = combat_director_instance_id,
	combat_director_fsm_id = combat_director_fsm_id,
	overgang_timeline_id = overgang_timeline_id,
	overgang_in_frames = overgang_in_frames,
	overgang_hold_frames = overgang_hold_frames,
	overgang_out_frames = overgang_out_frames,
	overgang_frame_count = overgang_frame_count,
	overgang_ticks_per_frame = overgang_ticks_per_frame,
	overgang_fade_out_frames = overgang_fade_out_frames,
	overgang_fade_in_frames = overgang_fade_in_frames,
	overgang_post_fade_in_timeline_id = overgang_post_fade_in_timeline_id,
	transition_panel_in_frames = transition_panel_in_frames,
	transition_panel_hold_frames = transition_panel_hold_frames,
	transition_panel_out_frames = transition_panel_out_frames,
	transition_panel_gap_frames = transition_panel_gap_frames,
	transition_accent_in_frames = transition_accent_in_frames,
	transition_accent_hold_frames = transition_accent_hold_frames,
	transition_accent_out_frames = transition_accent_out_frames,
	transition_text_in_frames = transition_text_in_frames,
	transition_text_hold_frames = transition_text_hold_frames,
	transition_text_out_frames = transition_text_out_frames,
	transition_flash_frames = transition_flash_frames,
	transition_flash_mix = transition_flash_mix,
	combat_fade_timeline_id = combat_fade_timeline_id,
	combat_fade_out_frames = combat_fade_out_frames,
	combat_fade_hold_frames = combat_fade_hold_frames,
	combat_fade_in_frames = combat_fade_in_frames,
	combat_fade_frame_count = combat_fade_frame_count,
	combat_fade_ticks_per_frame = combat_fade_ticks_per_frame,
	combat_intro_timeline_id = combat_intro_timeline_id,
	combat_intro_maya_b_frames = combat_intro_maya_b_frames,
	combat_intro_reveal_frames = combat_intro_reveal_frames,
	combat_intro_ticks_per_frame = combat_intro_ticks_per_frame,
	combat_intro_hold_frames = combat_intro_hold_frames,
	combat_intro_whoosh_strength = combat_intro_whoosh_strength,
	combat_intro_maya_b_start_scale = combat_intro_maya_b_start_scale,
	combat_intro_maya_b_end_scale = combat_intro_maya_b_end_scale,
	combat_intro_maya_a_scale_ratio = combat_intro_maya_a_scale_ratio,
	combat_intro_monster_start_y_offset = combat_intro_monster_start_y_offset,
	combat_intro_monster_arc_x = combat_intro_monster_arc_x,
	combat_intro_monster_arc_y = combat_intro_monster_arc_y,
	combat_intro_maya_a_arc_x = combat_intro_maya_a_arc_x,
	combat_intro_maya_a_arc_y = combat_intro_maya_a_arc_y,
	combat_intro_maya_b_arc_y = combat_intro_maya_b_arc_y,
	combat_focus_timeline_id = combat_focus_timeline_id,
	combat_hover_timeline_id = combat_hover_timeline_id,
	combat_parallax_timeline_id = combat_parallax_timeline_id,
	combat_focus_zoom_frames = combat_focus_zoom_frames,
	combat_focus_vanish_frames = combat_focus_vanish_frames,
	combat_focus_ticks_per_frame = combat_focus_ticks_per_frame,
	combat_focus_zoom_scale = combat_focus_zoom_scale,
	combat_focus_vanish_scale_x = combat_focus_vanish_scale_x,
	combat_focus_vanish_scale_y = combat_focus_vanish_scale_y,
	combat_focus_zoom_arc_x = combat_focus_zoom_arc_x,
	combat_focus_zoom_arc_y = combat_focus_zoom_arc_y,
	combat_focus_vanish_arc_x = combat_focus_vanish_arc_x,
	combat_focus_vanish_arc_y = combat_focus_vanish_arc_y,
	combat_focus_vanish_lift = combat_focus_vanish_lift,
	fade_timeline_id = fade_timeline_id,
	fade_out_frames = fade_out_frames,
	fade_hold_frames = fade_hold_frames,
	fade_in_frames = fade_in_frames,
	fade_frame_count = fade_frame_count,
	fade_ticks_per_frame = fade_ticks_per_frame,
	combat_hit_timeline_id = combat_hit_timeline_id,
	combat_hit_frame_count = combat_hit_frame_count,
	combat_hit_ticks_per_frame = combat_hit_ticks_per_frame,
	combat_hit_stop_frames = combat_hit_stop_frames,
	combat_hit_peak_frames = combat_hit_peak_frames,
	combat_hit_recover_frames = combat_hit_recover_frames,
	combat_hit_knockback_x = combat_hit_knockback_x,
	combat_hit_knockback_y = combat_hit_knockback_y,
	combat_hit_shake_frames = combat_hit_shake_frames,
	combat_hit_shake_x = combat_hit_shake_x,
	combat_hit_shake_y = combat_hit_shake_y,
	combat_hit_scale_x = combat_hit_scale_x,
	combat_hit_scale_y = combat_hit_scale_y,
	combat_hit_slash_path_start_x_ratio = combat_hit_slash_path_start_x_ratio,
	combat_hit_slash_path_start_y_ratio = combat_hit_slash_path_start_y_ratio,
	combat_hit_slash_path_end_x_ratio = combat_hit_slash_path_end_x_ratio,
	combat_hit_slash_path_end_y_ratio = combat_hit_slash_path_end_y_ratio,
	combat_hit_slash_length_ratio = combat_hit_slash_length_ratio,
	combat_hit_slash_thickness_ratio = combat_hit_slash_thickness_ratio,
	combat_hit_slash_peak_scale = combat_hit_slash_peak_scale,
	combat_hit_slash_alpha = combat_hit_slash_alpha,
	combat_hit_slash_taper_floor = combat_hit_slash_taper_floor,
	combat_hit_slash_z = combat_hit_slash_z,
	combat_dodge_timeline_id = combat_dodge_timeline_id,
	combat_dodge_frame_count = combat_dodge_frame_count,
	combat_dodge_ticks_per_frame = combat_dodge_ticks_per_frame,
	combat_dodge_anticipation_frames = combat_dodge_anticipation_frames,
	combat_dodge_peak_frames = combat_dodge_peak_frames,
	combat_dodge_recover_frames = combat_dodge_recover_frames,
	combat_dodge_anticipation_scale_x = combat_dodge_anticipation_scale_x,
	combat_dodge_anticipation_scale_y = combat_dodge_anticipation_scale_y,
	combat_dodge_move_scale_x = combat_dodge_move_scale_x,
	combat_dodge_move_scale_y = combat_dodge_move_scale_y,
	combat_exchange_hit_timeline_id = combat_exchange_hit_timeline_id,
	combat_exchange_hit_frame_count = combat_exchange_hit_frame_count,
	combat_exchange_hit_ticks_per_frame = combat_exchange_hit_ticks_per_frame,
	combat_exchange_miss_timeline_id = combat_exchange_miss_timeline_id,
	combat_exchange_miss_frame_count = combat_exchange_miss_frame_count,
	combat_exchange_miss_ticks_per_frame = combat_exchange_miss_ticks_per_frame,
	combat_exchange_anticipate_frames = combat_exchange_anticipate_frames,
	combat_exchange_lunge_frames = combat_exchange_lunge_frames,
	combat_exchange_hitstop_frames = combat_exchange_hitstop_frames,
	combat_exchange_lunge_distance = combat_exchange_lunge_distance,
	combat_exchange_lunge_lift = combat_exchange_lunge_lift,
	combat_exchange_lunge_scale = combat_exchange_lunge_scale,
	combat_exchange_lunge_punch = combat_exchange_lunge_punch,
	combat_exchange_hit_recoil_distance = combat_exchange_hit_recoil_distance,
	combat_exchange_hit_recoil_lift = combat_exchange_hit_recoil_lift,
	combat_exchange_hit_recoil_hold_frames = combat_exchange_hit_recoil_hold_frames,
	combat_exchange_hit_recoil_recover_frames = combat_exchange_hit_recoil_recover_frames,
	combat_exchange_hit_scale_x = combat_exchange_hit_scale_x,
	combat_exchange_hit_scale_y = combat_exchange_hit_scale_y,
	combat_exchange_hit_impact_scale_x = combat_exchange_hit_impact_scale_x,
	combat_exchange_hit_impact_scale_y = combat_exchange_hit_impact_scale_y,
	combat_exchange_hit_shake_x = combat_exchange_hit_shake_x,
	combat_exchange_hit_shake_y = combat_exchange_hit_shake_y,
	combat_exchange_hit_overlay_alpha = combat_exchange_hit_overlay_alpha,
	combat_exchange_miss_dodge_distance = combat_exchange_miss_dodge_distance,
	combat_exchange_miss_dodge_lift = combat_exchange_miss_dodge_lift,
	combat_exchange_miss_dodge_hold_frames = combat_exchange_miss_dodge_hold_frames,
	combat_exchange_miss_dodge_recover_frames = combat_exchange_miss_dodge_recover_frames,
	combat_exchange_miss_dodge_bob_amp = combat_exchange_miss_dodge_bob_amp,
	combat_exchange_miss_dodge_bob_period_frames = combat_exchange_miss_dodge_bob_period_frames,
	combat_exchange_miss_dodge_scale_x = combat_exchange_miss_dodge_scale_x,
	combat_exchange_miss_dodge_scale_y = combat_exchange_miss_dodge_scale_y,
	combat_all_out_timeline_id = combat_all_out_timeline_id,
	combat_all_out_frame_count = combat_all_out_frame_count,
	combat_all_out_ticks_per_frame = combat_all_out_ticks_per_frame,
	combat_all_out_pulse_period_frames = combat_all_out_pulse_period_frames,
	combat_all_out_pulse_amp = combat_all_out_pulse_amp,
	combat_results_fade_out_timeline_id = combat_results_fade_out_timeline_id,
	combat_results_fade_out_frames = combat_results_fade_out_frames,
	combat_results_fade_out_ticks_per_frame = combat_results_fade_out_ticks_per_frame,
	combat_exit_fade_in_timeline_id = combat_exit_fade_in_timeline_id,
	combat_exit_fade_in_frames = combat_exit_fade_in_frames,
	combat_exit_fade_in_ticks_per_frame = combat_exit_fade_in_ticks_per_frame,
	combat_results_fade_in_timeline_id = combat_results_fade_in_timeline_id,
	combat_results_fade_in_frames = combat_results_fade_in_frames,
	combat_results_fade_in_ticks_per_frame = combat_results_fade_in_ticks_per_frame,
	combat_monster_hover_period_seconds = combat_monster_hover_period_seconds,
	combat_monster_hover_amp = combat_monster_hover_amp,
	combat_monster_dodge_distance = combat_monster_dodge_distance,
	combat_parallax_vy_base = combat_parallax_vy_base,
	combat_parallax_vy_momentum = combat_parallax_vy_momentum,
	combat_parallax_scale_base = combat_parallax_scale_base,
	combat_parallax_scale_momentum = combat_parallax_scale_momentum,
	combat_parallax_impact_amp = combat_parallax_impact_amp,
	combat_parallax_momentum_step = combat_parallax_momentum_step,
	combat_parallax_impact_duration_seconds = combat_parallax_impact_duration_seconds,
	combat_parallax_bias_base = combat_parallax_bias_base,
	combat_parallax_bias_momentum = combat_parallax_bias_momentum,
	combat_parallax_parallax_strength = combat_parallax_parallax_strength,
	combat_parallax_scale_strength = combat_parallax_scale_strength,
	combat_parallax_flip_strength = combat_parallax_flip_strength,
	combat_parallax_flip_window_seconds = combat_parallax_flip_window_seconds,
	p3_blue_r = p3_blue_r,
	p3_blue_g = p3_blue_g,
	p3_blue_b = p3_blue_b,
	p3_cyan_r = p3_cyan_r,
	p3_cyan_g = p3_cyan_g,
	p3_cyan_b = p3_cyan_b,
	p3_ink_r = p3_ink_r,
	p3_ink_g = p3_ink_g,
	p3_ink_b = p3_ink_b,
	p3_black_r = p3_black_r,
	p3_black_g = p3_black_g,
	p3_black_b = p3_black_b,
	p3_transition_palette_dialogue = p3_transition_palette_dialogue,
	p3_transition_palette_combat = p3_transition_palette_combat,
	p3_transition_palette_ending = p3_transition_palette_ending,
	p3_transition_palette_choice = p3_transition_palette_choice,
	combat_results_bg_r = combat_results_bg_r,
	combat_results_bg_g = combat_results_bg_g,
	combat_results_bg_b = combat_results_bg_b,
	combat_results_bg_a = combat_results_bg_a,
	clear_texts = clear_texts,
	apply_background = apply_background,
	show_background = show_background,
	reset_text_colors = reset_text_colors,
	hide_transition_layers = hide_transition_layers,
	hide_combat_sprites = hide_combat_sprites,
}
