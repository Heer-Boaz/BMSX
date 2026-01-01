bg_id = 'p3.bg'
combat_monster_id = 'p3.combat.monster'
combat_maya_a_id = 'p3.combat.maya_a'
combat_maya_b_id = 'p3.combat.maya_b'
combat_all_out_id = 'p3.combat.all_out'
text_main_id = 'p3.text.main'
text_choice_id = 'p3.text.choice'
text_prompt_id = 'p3.text.prompt'
text_transition_id = 'p3.text.transition'
text_results_id = 'p3.text.results'
text_ids_all = { text_main_id, text_choice_id, text_prompt_id, text_transition_id, text_results_id }
text_ids_core = { text_main_id, text_choice_id, text_prompt_id, text_transition_id }
text_ids_choice_prompt = { text_choice_id, text_prompt_id }
text_ids_transition_results = { text_transition_id, text_results_id }
transition_overlay_id = 'p3.transition.overlay'
transition_panel_ids = { 'p3.transition.panel.a', 'p3.transition.panel.b', 'p3.transition.panel.c' }
transition_accent_id = 'p3.transition.accent'

director_instance_id = 'p3.director.instance'
combat_director_def_id = 'p3.combat.director'
combat_director_instance_id = 'p3.combat.director.instance'
combat_director_fsm_id = 'p3.combat.director.fsm'

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
combat_intro_maya_b_start_scale = 1.08
combat_intro_maya_b_end_scale = 0.9
combat_intro_maya_a_scale_ratio = 0.6
combat_intro_monster_arc_x = 24
combat_intro_monster_arc_y = 8
combat_intro_maya_a_arc_x = -12
combat_intro_maya_a_arc_y = -4
combat_intro_maya_b_arc_y = -6
combat_focus_timeline_id = 'combat_focus'
combat_focus_zoom_frames = 8
combat_focus_vanish_frames = 12
combat_focus_ticks_per_frame = 24
combat_focus_zoom_scale = 1.22
combat_focus_vanish_scale = 1.55
combat_focus_zoom_arc_x = 10
combat_focus_zoom_arc_y = -6
combat_focus_vanish_arc_x = -6
combat_focus_vanish_arc_y = -8
combat_focus_vanish_lift = -18

fade_timeline_id = 'fade'
fade_out_frames = 18
fade_hold_frames = 12
fade_in_frames = 18
fade_frame_count = fade_out_frames + fade_hold_frames + fade_in_frames
fade_ticks_per_frame = 32

combat_hit_timeline_id = 'combat_hit'
combat_hit_frame_count = 16
combat_hit_ticks_per_frame = 24

combat_dodge_timeline_id = 'combat_dodge'
combat_dodge_frame_count = 20
combat_dodge_ticks_per_frame = 24

combat_exchange_hit_timeline_id = 'combat_exchange_hit'
combat_exchange_hit_frame_count = 22
combat_exchange_hit_ticks_per_frame = 24
combat_exchange_miss_timeline_id = 'combat_exchange_miss'
combat_exchange_miss_frame_count = 22
combat_exchange_miss_ticks_per_frame = 24
combat_exchange_impact_start_ratio = 0.38
combat_exchange_impact_end_ratio = 0.72
combat_exchange_lunge_distance = 96
combat_exchange_lunge_lift = 18
combat_exchange_lunge_scale = 1.25
combat_exchange_lunge_punch = 0.12
combat_exchange_hit_recoil_distance = -36
combat_exchange_hit_recoil_lift = 10
combat_exchange_hit_shake_x = 8
combat_exchange_hit_shake_y = 6
combat_exchange_hit_flash_dim = 0.2
combat_exchange_miss_dodge_distance = -28
combat_exchange_miss_dodge_lift = -16

combat_all_out_timeline_id = 'combat_all_out'
combat_all_out_frame_count = 150
combat_all_out_ticks_per_frame = 1
combat_all_out_pulse_period_frames = 32
combat_all_out_pulse_amp = 0.05

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
combat_monster_hover_amp = 6
combat_monster_dodge_distance = 24

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

function set_text_lines(text_object_id, lines, typed)
	local text_obj = object(text_object_id)
	-- Convert table to newline-separated string (portable to C++)
	local should_type = typed == true
	text_obj:set_text(lines, { typed = should_type, snap = not should_type })
end

function clear_text(text_object_id)
	set_text_lines(text_object_id, {}, false)
	local text_obj = object(text_object_id)
	text_obj.highlighted_line_index = nil
end

function clear_texts(text_ids)
	for i = 1, #text_ids do
		clear_text(text_ids[i])
	end
end

function finish_text(text_object_id)
	local text_obj = object(text_object_id)
	text_obj:reveal_text()
end

function apply_background(id)
	if id == nil then
		return
	end
	local bg = object(bg_id)
	bg:set_image(id)
end

function reset_text_colors()
	object(text_main_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	object(text_choice_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	object(text_prompt_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	object(text_transition_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	object(text_results_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
end

function hide_transition_layers()
	local overlay = object(transition_overlay_id)
	overlay.visible = false
	overlay.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
	for i = 1, #transition_panel_ids do
		local panel = object(transition_panel_ids[i])
		panel.visible = false
		panel.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
	end
	local accent = object(transition_accent_id)
	accent.visible = false
	accent.sprite_component.colorize = { r = 0, g = 0, b = 0, a = 0 }
end

function set_prompt_line(text)
	set_text_lines(text_prompt_id, { text }, false)
end

function hide_combat_sprites()
	object(combat_monster_id).visible = false
	object(combat_maya_a_id).visible = false
	object(combat_maya_b_id).visible = false
	object(combat_all_out_id).visible = false
end

return true
