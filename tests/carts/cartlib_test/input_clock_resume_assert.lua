local clock<const> = require('cartlib/clock')
local input<const> = require('cartlib/input/input')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	phase = 'released_modal_input',
	phase_frames = 0,
}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	input.add_player(1)
	test.down_pressed = input.bind(1, clock.gameplay, 'down[p]')
	test.down_just_pressed = input.bind(1, clock.gameplay, 'down[jp]')
	test.right_pressed = input.bind(1, clock.gameplay, 'right[p]')
	test.right_just_pressed = input.bind(1, clock.gameplay, 'right[jp]')
	test.right_just_released = input.bind(1, clock.gameplay, 'right[jr]')
	test.right_repeat_pressed = input.bind(1, clock.gameplay, 'right[rp]')
	world:set_gameplay_clock_running(false)
	return host.press('ArrowDown', 2)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.phase_frames = test.phase_frames + 1

	if test.phase == 'released_modal_input' then
		if test.phase_frames < 5 then
			return false
		end
		assert(not test.down_pressed(), 'paused gameplay clock evaluated modal input')
		world:set_gameplay_clock_running(true)
		test.phase = 'released_resume'
		return false
	end

	if test.phase == 'released_resume' then
		assert(not test.down_pressed(), 'released modal input remained pressed after resume')
		assert(not test.down_just_pressed(), 'modal input replayed as gameplay just_pressed')
		world:set_gameplay_clock_running(false)
		test.phase = 'held_modal_input'
		test.phase_frames = 0
		return host.down('ArrowRight')
	end

	if test.phase == 'held_modal_input' then
		if test.phase_frames < 5 then
			return false
		end
		world:set_gameplay_clock_running(true)
		test.phase = 'held_resume'
		return false
	end

	if test.phase == 'held_resume' then
		assert(test.right_pressed(), 'resume discarded the current held level')
		assert(not test.right_just_pressed(), 'held modal input replayed as gameplay just_pressed')
		assert(not test.right_repeat_pressed(), 'held modal input replayed as gameplay repeat')
		test.phase = 'release_after_resume'
		return host.up('ArrowRight')
	end

	assert(test.right_just_released(), 'post-resume release did not reach gameplay input')
	return true
end
