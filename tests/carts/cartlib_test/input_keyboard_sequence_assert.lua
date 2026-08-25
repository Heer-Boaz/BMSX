local clock<const> = require('cartlib/clock')
local input<const> = require('cartlib/input/input')

local overlapping_sequence<const> = {
	'KeyA', 'KeyA', 'KeyB', 'KeyA', 'KeyB',
}
local submitted_sequence<const> = {
	'KeyA', 'Digit1', 'Enter',
}

__bmsx_host_test = {
	phase = 'overlapping',
	key_index = 0,
	key_gap = false,
	frames = 0,
}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	input.add_player(1)
	test.overlapping, test.reset_overlapping = input.bind_keyboard_sequence(1, clock.frame, {
		keyboard = 'abab',
	})
	test.submitted = input.bind_keyboard_sequence(1, clock.frame, {
		keyboard = 'a1',
		submit = true,
	})
end

local press_next<const> = function(test, keys)
	if test.key_gap then
		test.key_gap = false
		return false
	end
	local key_index<const> = test.key_index + 1
	if key_index > #keys then
		return false
	end
	test.key_index = key_index
	test.key_gap = true
	return host.press(keys[key_index], 2)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 120, 'keyboard sequence scenario timed out phase=' .. test.phase)

	if test.phase == 'overlapping' then
		if test.overlapping() then
			test.reset_overlapping()
			test.phase = 'submitted'
			test.key_index = 0
			return false
		end
		return press_next(test, overlapping_sequence)
	end

	if test.submitted() then
		return true
	end
	return press_next(test, submitted_sequence)
end
