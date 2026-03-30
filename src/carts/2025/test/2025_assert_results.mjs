export default function schedule({ logger, test }) {
	test.run(async () => {
		await test.waitForCartActive({
			timeoutMs: 6000,
			pollMs: 100,
			settleMs: 500,
		});

		const objectState = await test.pollUntil(() => {
			const [state] = test.evalLua(`
				local main = object(text_main_id)
				local choice = object(text_choice_id)
				local prompt = object(text_prompt_id)
				local transition = object(text_transition_id)
				local results = object(text_results_id)
				return {
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

		test.assert(objectState.main_font, 'expected p3.text.main to have a font');
		test.assert(objectState.choice_font, 'expected p3.text.choice to have a font');
		test.assert(objectState.prompt_font, 'expected p3.text.prompt to have a font');
		test.assert(objectState.transition_font, 'expected p3.text.transition to have a font');
		test.assert(objectState.results_font, 'expected p3.text.results to have a font');

		const textState = await test.pollUntil(() => {
			const [state] = test.evalLua(`
				local function table_has_text(lines)
					if lines == nil or #lines <= 0 then
						return false
					end
					for i = 1, #lines do
						local line = lines[i]
						if line ~= nil and line ~= '' then
							return true
						end
					end
					return false
				end
				local function has_text(id)
					local obj = object(id)
					if obj == nil then
						return false
					end
					if table_has_text(obj.text) then
						return true
					end
					if table_has_text(obj.displayed_lines) then
						return true
					end
					return table_has_text(obj.full_text_lines)
				end
				local director = object('p3.director')
				return {
					node_id = director and director.node_id or nil,
					main = has_text(text_main_id),
					choice = has_text(text_choice_id),
					prompt = has_text(text_prompt_id),
					transition = has_text(text_transition_id),
					results = has_text(text_results_id),
				}
			`);
			if (state.node_id == null || state.node_id == 'intro') {
				return null;
			}
			if (state.main || state.choice || state.prompt || state.transition || state.results) {
				return state;
			}
			return null;
		}, {
			timeoutMs: 7000,
			pollMs: 100,
			description: '2025 story text',
		});

		test.assert(textState.node_id !== 'intro', `expected 2025 story to progress beyond intro, got node_id=${textState.node_id}`);
		test.assert(
			textState.main || textState.choice || textState.prompt || textState.transition || textState.results,
			'expected at least one 2025 textobject to contain rendered text'
		);

		logger(
			`[assert] 2025 text ok main=${textState.main} choice=${textState.choice} prompt=${textState.prompt} transition=${textState.transition} results=${textState.results}`
		);
		test.finish('[assert] 2025 assertions passed');
	});
}
