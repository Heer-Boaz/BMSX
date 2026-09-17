local progression<const> = require('cartlib/progression')
local events<const> = require('cartlib/event_emitter')

__bmsx_host_test = {}
function __bmsx_host_test.ready() return cartlib_test_ready end
function __bmsx_host_test.setup()
	local program<const> = progression.compile_program({
		rules = {
			{ id = 'unlock', on = 'scene_test.unlock', apply_once = true,
				set = { { key = 'door_open', value = true } },
				apply = { { op = 'reward' } } },
			{ id = 'visit', on = 'scene_test.visit', apply = { { op = 'visit' } } },
		},
		filters = {},
		handlers = {
			reward = function(ctx) ctx.rewards = ctx.rewards + 1 end,
			visit = function(ctx) ctx.visits = ctx.visits + 1 end,
		},
	})
	local state<const> = progression.new_state(program)
	local first<const> = { rewards = 0, visits = 0 }
	local second<const> = { rewards = 0, visits = 0 }
	progression.mount(first, program, state)
	events:emit('scene_test.unlock', first, {})
	events:emit('scene_test.visit', first, {})
	assert(first.rewards == 1 and first.visits == 1 and progression.get(first, 'door_open'),
		'progression did not record the first scene visit')
	progression.unmount(first)
	progression.mount(second, program, state)
	events:emit('scene_test.unlock', second, {})
	events:emit('scene_test.visit', second, {})
	assert(progression.get(second, 'door_open') and second.rewards == 0 and second.visits == 1,
		'replacing the controller reset persistent values or once-only rewards')
	assert(first.rewards == 1 and first.visits == 1, 'the old controller kept receiving events')
	progression.unmount(second)
	progression.mount(second, program, progression.new_state(program))
	assert(progression.get(second, 'door_open') == nil, 'a new session inherited old progress')
	events:emit('scene_test.unlock', second, {})
	assert(second.rewards == 1, 'once-only rewards did not reset for a new session')
	progression.unmount(second)
end
function __bmsx_host_test.update() return true end
