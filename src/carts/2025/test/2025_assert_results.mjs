export default function schedule({ logger, test }) {
	test.run(async () => {
		await test.waitForCartActive({
			timeoutMs: 6000,
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
					choice_font = choice ~= nil and choice.font ~= nil,
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
		test.assert(objectState.choice_font, 'expected p3.text.choice to have a font');
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
			test.assert(textProbeState.highlight_y === 96, `expected first highlight block to start at top 96, got ${textProbeState.highlight_y}`);
			test.assert(textProbeState.highlight_h === textProbeState.font_line_height, `expected single-line highlight height to match font line height, got ${textProbeState.highlight_h} vs ${textProbeState.font_line_height}`);
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
