local action_parser<const> = require('cartlib/input/action_parser')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

local action_state<const> = function(values)
	local state<const> = {
		pressed = false,
		just_pressed = false,
		all_just_pressed = false,
		just_released = false,
		all_just_released = false,
		guarded_just_pressed = false,
		repeat_pressed = false,
		consumed = false,
		press_time = 0,
		repeat_count = 0,
		min_press_delta = 100,
		min_release_delta = 100,
	}
	for key, value in pairs(values) do
		state[key] = value
	end
	return state
end

local state_at<const> = function(states, index)
	return states[index]
end

local ignore_input_sample<const> = function()
end

local evaluate<const> = function(source, states, window)
	return action_parser.compile(source).evaluation_factory(
		ignore_input_sample,
		false,
		state_at,
		states,
		window
	)()
end

function __bmsx_host_test.setup()
	local pressed<const> = action_state({ pressed = true })
	local idle<const> = action_state({})
	local program<const> = action_parser.compile('a[p] || b[p]')
	assert(program == action_parser.compile('a[p] || b[p]'))
	assert(program.action_names[1] == 'a' and program.action_names[2] == 'b')

	local reads<const> = { 0, 0 }
	local count_state<const> = function(states, index)
		reads[index] = reads[index] + 1
		return states[index]
	end
	assert(program.evaluation_factory(
		ignore_input_sample,
		false,
		count_state,
		{ pressed, idle },
		4
	)())
	assert(reads[1] == 1 and reads[2] == 0)

	assert(evaluate('a[p] || b[p] && c[p]', { pressed, idle, idle }, 4))
	assert(not evaluate('a[p] && !b[p]', { pressed, pressed }, 4))
	assert(evaluate('?(a, b)', { idle, pressed }, 4))
	assert(not evaluate('&(a, b)', { idle, pressed }, 4))
	assert(evaluate('&()', {}, 4))
	assert(not evaluate('?()', {}, 4))

	assert(evaluate('a[r,h,t{>=1.5},rc{==2}]', {
		action_state({ press_time = 2, repeat_count = 2 }),
	}, 4))
	assert(evaluate('a[jp,&jp,jr,&jr,gp,rp]', {
		action_state({
			just_pressed = true,
			all_just_pressed = true,
			just_released = true,
			all_just_released = true,
			guarded_just_pressed = true,
			repeat_pressed = true,
		}),
	}, 4))
	assert(evaluate('a[t{<2},rc{!=3}]', {
		action_state({ press_time = 1.5, repeat_count = 2 }),
	}, 4))
	assert(evaluate('a[!p,!c]', { idle }, 4))
	assert(evaluate('a[c]', { action_state({ consumed = true }) }, 4))
	assert(not evaluate('a[jp]', { action_state({ just_pressed = true, consumed = true }) }, 4))
	assert(evaluate('a[wp{3},wr{4}]', {
		action_state({ min_press_delta = 2, min_release_delta = 3 }),
	}, 4))

	assert(evaluate('?jp(a, b)', {
		action_state({ just_pressed = true }),
		idle,
	}, 4))
	assert(evaluate('(a | b)[jp]', {
		action_state({ just_pressed = true }),
		idle,
	}, 4))
	assert(evaluate('&jp(a, b)', {
		action_state({ just_pressed = true }),
		action_state({ just_pressed = true }),
	}, 4))
	assert(not evaluate('&jp(a[jr], b)', {
		action_state({ just_released = true }),
		action_state({ just_pressed = true }),
	}, 4))
	assert(evaluate('?jp(a[p] && b[jp])', {
		pressed,
		action_state({ just_pressed = true }),
	}, 4))
	assert(not evaluate('&jp(a[p] && b[jp])', {
		pressed,
		action_state({ just_pressed = true }),
	}, 4))
	assert(evaluate('?wp{3}(&(a, b))', {
		action_state({ min_press_delta = 2 }),
		action_state({ min_press_delta = 1 }),
	}, 9))
	assert(not evaluate('?wp{3}(a)', {
		action_state({ min_press_delta = 3 }),
	}, 9))
	assert(evaluate('?jr(a[jr])', {
		action_state({ just_released = true }),
	}, 4))
	assert(evaluate('?gp(a)', {
		action_state({ guarded_just_pressed = true }),
	}, 4))
	assert(evaluate('?rp(a)', {
		action_state({ repeat_pressed = true }),
	}, 4))
	assert(evaluate('&wp{4}(a, b)', {
		action_state({ min_press_delta = 2 }),
		action_state({ min_press_delta = 3 }),
	}, 9))
	assert(evaluate('?wr(a[jr])', {
		action_state({ just_released = true, min_release_delta = 3 }),
	}, 4))

	return nil
end

function __bmsx_host_test.update()
	return true
end
