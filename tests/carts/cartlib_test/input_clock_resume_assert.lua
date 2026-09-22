local clock<const> = require('cartlib/clock')
local input<const> = require('cartlib/input/input')
local world<const> = require('cartlib/world/world')
return {
	kind = 'integration',
	tests = {
		clock_resume_preserves_levels_not_modal_edges = function(t)
			t:wait_until('cartlib fixture', function() return cartlib_test_ready end, 120)
			local test<const> = {}
			input.add_player(1)
			test.down_pressed = input.bind(1, clock.gameplay, 'down[p]')
			test.down_just_pressed = input.bind(1, clock.gameplay, 'down[jp]')
			test.right_pressed = input.bind(1, clock.gameplay, 'right[p]')
			test.right_just_pressed = input.bind(1, clock.gameplay, 'right[jp]')
			test.right_just_released = input.bind(1, clock.gameplay, 'right[jr]')
			test.right_repeat_pressed = input.bind(1, clock.gameplay, 'right[rp]')
			world:set_gameplay_clock_running(false)
			t:press('ArrowDown', 2)
			t:wait_ticks(5)
			assert(not test.down_pressed(), 'paused gameplay clock evaluated modal input')
			world:set_gameplay_clock_running(true)
			t:at_boundary(world:request_mutation_boundary(), 10)
			assert(not test.down_pressed(), 'released modal input remained pressed after resume')
			assert(not test.down_just_pressed(), 'modal input replayed as gameplay just_pressed')
			world:set_gameplay_clock_running(false)
			t:down('ArrowRight')
			t:wait_ticks(5)
			world:set_gameplay_clock_running(true)
			t:at_boundary(world:request_mutation_boundary(), 10)
			assert(test.right_pressed(), 'resume discarded the current held level')
			assert(not test.right_just_pressed(), 'held modal input replayed as gameplay just_pressed')
			assert(not test.right_repeat_pressed(), 'held modal input replayed as gameplay repeat')
			t:up('ArrowRight')
			t:wait_until('post-resume release', test.right_just_released, 10)
		end,
	},
}
