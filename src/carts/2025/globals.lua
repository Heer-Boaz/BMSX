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

combat_results_bg_r = 0.07
combat_results_bg_g = 0.28
combat_results_bg_b = 0.8
combat_results_bg_a = 0.85

function smoothstep(u)
	return u * u * (3 - 2 * u)
end

function pingpong01(u)
	local p = u % 2
	if p < 1 then
		return p
	end
	return 2 - p
end

function arc01(u)
	if u <= 0.5 then
		return smoothstep(u * 2)
	end
	return smoothstep((1 - u) * 2)
end

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
