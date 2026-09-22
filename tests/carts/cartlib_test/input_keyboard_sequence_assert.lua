local clock<const> = require('cartlib/clock')
local input<const> = require('cartlib/input/input')
local overlapping_sequence<const> = {
	'KeyA', 'KeyA', 'KeyB', 'KeyA', 'KeyB',
}
local submitted_sequence<const> = {
	'KeyA', 'Digit1', 'Enter',
}
return {
	kind = 'integration',
	tests = {
		keyboard_sequences = function(t)
			t:wait_until('cartlib fixture', function() return cartlib_test_ready end, 120)
			input.add_player(1)
			input.push_context(1, 'sequence_probe', { a = {'KeyA'}, b = {'KeyB'}, one = {'Digit1'}, enter = {'Enter'} }, {}, {}, 200, true)
			local action_by_key<const> = {['KeyA'] = 'a', ['KeyB'] = 'b', ['Digit1'] = 'one', ['Enter'] = 'enter'}
			local overlapping<const>, reset_overlapping<const> = input.bind_keyboard_sequence(1, clock.frame, {keyboard = 'abab'})
			local submitted<const> = input.bind_keyboard_sequence(1, clock.frame, {keyboard = 'a1', submit = true})
			for index = 1, #overlapping_sequence do
				local action<const> = action_by_key[overlapping_sequence[index]]
				local pressed<const> = input.bind(1, clock.frame, action .. '[jp]')
				local released<const> = input.bind(1, clock.frame, action .. '[jr]')
				t:down(overlapping_sequence[index])
				t:wait_until('key reaches frame clock', pressed, 10)
				assert(overlapping() == (index == #overlapping_sequence), 'overlapping prefix matched at the wrong key')
				t:up(overlapping_sequence[index])
				t:wait_until('release reaches frame clock', released, 10)
			end
			reset_overlapping()
			for index = 1, #submitted_sequence do
				local action<const> = action_by_key[submitted_sequence[index]]
				local pressed<const> = input.bind(1, clock.frame, action .. '[jp]')
				local released<const> = input.bind(1, clock.frame, action .. '[jr]')
				t:down(submitted_sequence[index])
				t:wait_until('key reaches frame clock', pressed, 10)
				assert(submitted() == (index == #submitted_sequence), 'submitted sequence matched before Enter')
				t:up(submitted_sequence[index])
				t:wait_until('release reaches frame clock', released, 10)
			end
		end,
	},
}
