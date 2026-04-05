export default function schedule({ logger, test }) {
	test.run(async () => {
		await test.waitForCartActive({
			timeoutMs: 15000,
			pollMs: 100,
			settleMs: 100,
		});

		const objectState = await test.pollUntil(() => {
			const [state] = test.evalLua(`
				local globals = require('globals')
				local main_id = globals.text_main_id
				local choice_id = globals.text_choice_id
				local prompt_id = globals.text_prompt_id
				local transition_id = globals.text_transition_id
				local results_id = globals.text_results_id
				local main = main_id ~= nil and oget(main_id) or nil
				local choice = choice_id ~= nil and oget(choice_id) or nil
				local prompt = prompt_id ~= nil and oget(prompt_id) or nil
				local transition = transition_id ~= nil and oget(transition_id) or nil
				local results = results_id ~= nil and oget(results_id) or nil
				return {
					main_id = main_id,
					choice_id = choice_id,
					prompt_id = prompt_id,
					transition_id = transition_id,
					results_id = results_id,
					has_main = main ~= nil,
					has_choice = choice ~= nil,
					has_prompt = prompt ~= nil,
					has_transition = transition ~= nil,
					has_results = results ~= nil,
					main_font = main ~= nil and main.font ~= nil,
						main_blank_lines = main ~= nil and main.blank_lines or nil,
						main_line_height = main ~= nil and main.line_height or nil,
						choice_font = choice ~= nil and choice.font ~= nil,
						choice_blank_lines = choice ~= nil and choice.blank_lines or nil,
						choice_line_height = choice ~= nil and choice.line_height or nil,
						choice_font_line_height = choice ~= nil and choice.font.line_height or nil,
					prompt_font = prompt ~= nil and prompt.font ~= nil,
					transition_font = transition ~= nil and transition.font ~= nil,
					results_font = results ~= nil and results.font ~= nil,
				}
			`);
			if (!state.has_main || !state.has_choice || !state.has_prompt || !state.has_transition || !state.has_results) {
				return null;
			}
			return state;
		}, {
			timeoutMs: 3000,
			pollMs: 100,
			description: '2025 textobjects',
		});

		test.assert(objectState.main_id != null, 'expected text_main_id global to exist');
		test.assert(objectState.choice_id != null, 'expected text_choice_id global to exist');
		test.assert(objectState.prompt_id != null, 'expected text_prompt_id global to exist');
		test.assert(objectState.transition_id != null, 'expected text_transition_id global to exist');
		test.assert(objectState.results_id != null, 'expected text_results_id global to exist');
		test.assert(objectState.main_font, 'expected p3.text.main to have a font');
		test.assert(objectState.main_blank_lines === 1, `expected p3.text.main blank_lines to be 1, got ${objectState.main_blank_lines}`);
		test.assert(objectState.main_line_height === 16, `expected p3.text.main line_height to be 16, got ${objectState.main_line_height}`);
		test.assert(objectState.choice_font, 'expected p3.text.choice to have a font');
		test.assert(objectState.choice_blank_lines === 1, `expected p3.text.choice blank_lines to be 1, got ${objectState.choice_blank_lines}`);
		test.assert(objectState.choice_line_height === objectState.choice_font_line_height * (objectState.choice_blank_lines + 1), `expected p3.text.choice line_height to reflect blank_lines, got ${objectState.choice_line_height} vs ${objectState.choice_font_line_height}`);
		test.assert(objectState.prompt_font, 'expected p3.text.prompt to have a font');
		test.assert(objectState.transition_font, 'expected p3.text.transition to have a font');
		test.assert(objectState.results_font, 'expected p3.text.results to have a font');

		const [textProbeState] = test.evalLua(`
			local globals = require('globals')
			local main = oget(globals.text_main_id)
			main:clear_text()
			main:set_text({ 'AB' }, { typed = true, snap = false })
			main:type_next()
			local step1 = main.displayed_lines[1]
			main:type_next()
			local step2 = main.displayed_lines[1]
			main:type_next()
			local step3 = main.displayed_lines[1]
			main:reveal_text()
			local final_line = main.displayed_lines[1]
			main:set_text({ 'AB' }, { typed = false, snap = true })
			main.highlighted_line_index = 0
			local highlight_y<const>, highlight_h<const> = main:compute_highlight_block()
			main.highlighted_line_index = nil
			local choice = oget(globals.text_choice_id)
			local original_choice_max<const> = choice.maximum_characters_per_line
			choice.maximum_characters_per_line = 7
			choice:set_text({ 'AB CD EF', 'GH' }, { typed = false, snap = true })
			local choice_offset_1 = choice.wrapped_line_y_offsets[1]
			local choice_offset_2 = choice.wrapped_line_y_offsets[2]
			local choice_offset_3 = choice.wrapped_line_y_offsets[3]
			choice.maximum_characters_per_line = original_choice_max
			local timeline_builders = require('timeline_builders')
			local exchange_frames = timeline_builders.build_combat_exchange_frames({
				frame_count = 4,
				monster_base_x = 100,
				monster_base_y = 60,
				maya_base_x = 140,
				maya_base_y = 60,
				maya_offset_x = 8,
				maya_offset_y = -4,
				maya_hold_frames = 1,
				maya_recover_frames = 1,
				maya_bob_amp = 1,
				maya_bob_period_frames = 2,
				maya_react_scale_x = 0.1,
				maya_react_scale_y = -0.1,
				maya_impact_scale_x = 0.2,
				maya_impact_scale_y = -0.2,
				flash = true,
				flash_r = 1,
				flash_g = 0.5,
				flash_b = 0.5,
				squash = true,
				cam_shake_x = 1,
				cam_shake_y = 1,
				overlay_alpha = 0.35,
			})
			local exchange_overlay = exchange_frames[1].overlay
			local combat_fade_frames = timeline_builders.build_combat_fade_frames()
			local combat_fade_overlay = combat_fade_frames[1].overlay
			local combat_fade_sprite_component = combat_fade_frames[1].sprite_component
			local timeline = require('timeline')
			local catchup = timeline.new({
				id = 'catchup',
				frames = timeline.range(4),
				ticks_per_frame = 24,
				playback_mode = 'once',
			})
			catchup:update(20)
			local catchup_after_20 = catchup:value()
			local catchup_events_after_20 = catchup.step_event_count
			catchup:update(20)
			local catchup_after_40 = catchup:value()
			local catchup_events_after_40 = catchup.step_event_count
			local catchup_event_40 = catchup.step_events[1] ~= nil and catchup.step_events[1].current or nil
			catchup:update(20)
			local catchup_after_60 = catchup:value()
			local catchup_events_after_60 = catchup.step_event_count
			local catchup_event_60 = catchup.step_events[1] ~= nil and catchup.step_events[1].current or nil
			local catchup_multi = timeline.new({
				id = 'catchup_multi',
				frames = timeline.range(5),
				ticks_per_frame = 24,
				playback_mode = 'once',
			})
			catchup_multi:update(60)
			local catchup_multi_value = catchup_multi:value()
			local catchup_multi_events = catchup_multi.step_event_count
			local catchup_multi_event_1 = catchup_multi.step_events[1] ~= nil and catchup_multi.step_events[1].current or nil
			local catchup_multi_event_2 = catchup_multi.step_events[2] ~= nil and catchup_multi.step_events[2].current or nil
			local original_max<const> = main.maximum_characters_per_line
			main.maximum_characters_per_line = 7
			main:set_text({ 'AB CD EF' }, { typed = false, snap = true })
			local wrap_count = #main.full_text_lines
			local wrap_line_1 = main.full_text_lines[1]
			local wrap_line_2 = main.full_text_lines[2]
			main.maximum_characters_per_line = original_max
			main:set_text({ 'AB', '', 'CD' }, { typed = false, snap = true })
			return {
				step1 = step1,
				step2 = step2,
				step3 = step3,
				final_line = final_line,
				wrap_count = wrap_count,
				wrap_line_1 = wrap_line_1,
				wrap_line_2 = wrap_line_2,
					highlight_y = highlight_y,
					highlight_h = highlight_h,
					font_line_height = main.font.line_height,
					choice_offset_1 = choice_offset_1,
					choice_offset_2 = choice_offset_2,
					choice_offset_3 = choice_offset_3,
					exchange_overlay_r = exchange_overlay.r,
					exchange_overlay_g = exchange_overlay.g,
						exchange_overlay_b = exchange_overlay.b,
						exchange_overlay_a = exchange_overlay.a,
						exchange_overlay_color = exchange_overlay.color,
						combat_fade_overlay_a = combat_fade_overlay.a,
						combat_fade_overlay_r = combat_fade_overlay.r,
						combat_fade_has_sprite_component = combat_fade_sprite_component ~= nil,
						catchup_after_20 = catchup_after_20,
						catchup_events_after_20 = catchup_events_after_20,
						catchup_after_40 = catchup_after_40,
						catchup_events_after_40 = catchup_events_after_40,
						catchup_event_40 = catchup_event_40,
						catchup_after_60 = catchup_after_60,
						catchup_events_after_60 = catchup_events_after_60,
						catchup_event_60 = catchup_event_60,
						catchup_multi_value = catchup_multi_value,
						catchup_multi_events = catchup_multi_events,
						catchup_multi_event_1 = catchup_multi_event_1,
						catchup_multi_event_2 = catchup_multi_event_2,
					line_height = main.line_height,
					component_line_height = main.text_component.line_height,
				full_count = #main.full_text_lines,
				displayed_count = #main.displayed_lines,
				blank_line = main.displayed_lines[2],
				logical_map_1 = main.wrapped_line_to_logical_line[1],
				logical_map_2 = main.wrapped_line_to_logical_line[2],
				logical_map_3 = main.wrapped_line_to_logical_line[3],
			}
		`);

		test.assert(textProbeState.step1 === 'A', `expected first typing step to reveal "A", got ${JSON.stringify(textProbeState.step1)}`);
		test.assert(textProbeState.step2 === 'AB', `expected second typing step to reveal "AB", got ${JSON.stringify(textProbeState.step2)}`);
		test.assert(textProbeState.step3 === 'AB', `expected finish-line step to keep "AB", got ${JSON.stringify(textProbeState.step3)}`);
			test.assert(textProbeState.final_line === 'AB', `expected reveal_text() to preserve final line "AB", got ${JSON.stringify(textProbeState.final_line)}`);
			test.assert(textProbeState.wrap_count === 2, `expected word-wrapped text to produce two lines, got ${textProbeState.wrap_count}`);
			test.assert(textProbeState.wrap_line_1 === 'AB CD', `expected first wrapped line to stop at word boundary, got ${JSON.stringify(textProbeState.wrap_line_1)}`);
			test.assert(textProbeState.wrap_line_2 === 'EF', `expected second wrapped line to contain remaining word, got ${JSON.stringify(textProbeState.wrap_line_2)}`);
			test.assert(textProbeState.highlight_y === 92, `expected first highlight block to include top padding, got ${textProbeState.highlight_y}`);
			test.assert(textProbeState.highlight_h === 16, `expected single-line highlight height to include top/bottom padding, got ${textProbeState.highlight_h}`);
			test.assert(textProbeState.choice_offset_1 === 0, `expected first wrapped option line offset to be 0, got ${textProbeState.choice_offset_1}`);
			test.assert(textProbeState.choice_offset_2 === 8, `expected wrapped line inside same option to stay tight, got ${textProbeState.choice_offset_2}`);
			test.assert(textProbeState.choice_offset_3 === 24, `expected next option to include one blank line gap, got ${textProbeState.choice_offset_3}`);
			test.assert(typeof textProbeState.exchange_overlay_r === 'number' && typeof textProbeState.exchange_overlay_g === 'number' && typeof textProbeState.exchange_overlay_b === 'number' && typeof textProbeState.exchange_overlay_a === 'number', `expected combat exchange overlay frame to be flat rgba, got ${JSON.stringify({ r: textProbeState.exchange_overlay_r, g: textProbeState.exchange_overlay_g, b: textProbeState.exchange_overlay_b, a: textProbeState.exchange_overlay_a, color: textProbeState.exchange_overlay_color })}`);
			test.assert(textProbeState.exchange_overlay_color == null, `expected combat exchange overlay frame to not use nested color table, got ${JSON.stringify(textProbeState.exchange_overlay_color)}`);
			test.assert(textProbeState.combat_fade_overlay_r === 0 && textProbeState.combat_fade_overlay_a === 0, `expected combat fade to start as transparent black overlay, got ${JSON.stringify({ r: textProbeState.combat_fade_overlay_r, a: textProbeState.combat_fade_overlay_a })}`);
			test.assert(!textProbeState.combat_fade_has_sprite_component, 'expected combat fade frames to target overlay state instead of sprite_component');
			test.assert(textProbeState.catchup_after_20 == null && textProbeState.catchup_events_after_20 === 0, `expected 24ms timeline to not advance on first 20ms update, got value=${JSON.stringify(textProbeState.catchup_after_20)} events=${textProbeState.catchup_events_after_20}`);
			test.assert(textProbeState.catchup_after_40 === 0 && textProbeState.catchup_events_after_40 === 1 && textProbeState.catchup_event_40 === 0, `expected 24ms timeline to advance to frame 0 after 40ms accumulated, got value=${JSON.stringify(textProbeState.catchup_after_40)} events=${textProbeState.catchup_events_after_40} event=${JSON.stringify(textProbeState.catchup_event_40)}`);
			test.assert(textProbeState.catchup_after_60 === 1 && textProbeState.catchup_events_after_60 === 1 && textProbeState.catchup_event_60 === 1, `expected 24ms timeline remainder to carry and reach frame 1 on the third 20ms update, got value=${JSON.stringify(textProbeState.catchup_after_60)} events=${textProbeState.catchup_events_after_60} event=${JSON.stringify(textProbeState.catchup_event_60)}`);
			test.assert(textProbeState.catchup_multi_value === 1 && textProbeState.catchup_multi_events === 2 && textProbeState.catchup_multi_event_1 === 0 && textProbeState.catchup_multi_event_2 === 1, `expected single 60ms update to catch up two timeline frames, got value=${JSON.stringify(textProbeState.catchup_multi_value)} events=${textProbeState.catchup_multi_events} seq=[${textProbeState.catchup_multi_event_1},${textProbeState.catchup_multi_event_2}]`);
			test.assert(textProbeState.line_height === 16, `expected 2025 text line_height to be 16, got ${textProbeState.line_height}`);
			test.assert(textProbeState.line_height === textProbeState.component_line_height, `expected textcomponent line_height to mirror textobject line_height, got ${textProbeState.component_line_height} vs ${textProbeState.line_height}`);
			test.assert(textProbeState.full_count === 3, `expected three wrapped lines for explicit blank line case, got ${textProbeState.full_count}`);
		test.assert(textProbeState.displayed_count === 3, `expected displayed blank-line case to keep three lines, got ${textProbeState.displayed_count}`);
		test.assert(textProbeState.blank_line === '', `expected middle line to stay empty, got ${JSON.stringify(textProbeState.blank_line)}`);
		test.assert(textProbeState.logical_map_1 === 1 && textProbeState.logical_map_2 === 2 && textProbeState.logical_map_3 === 3, `expected logical line map [1,2,3], got [${textProbeState.logical_map_1},${textProbeState.logical_map_2},${textProbeState.logical_map_3}]`);
		logger(`[assert] textobject typing ok step1=${JSON.stringify(textProbeState.step1)} step2=${JSON.stringify(textProbeState.step2)} blank_line=${JSON.stringify(textProbeState.blank_line)}`);
		test.finish('[assert] 2025 assertions passed');
	});
}
