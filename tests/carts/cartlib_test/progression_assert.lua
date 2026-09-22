local progression<const> = require('cartlib/progression')
local events<const> = require('cartlib/event_emitter')
return {
	kind = 'unit',
	tests = {
		session = function()


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
		end,
		rebind = function()


			local handlers<const> = { reward = function(ctx) ctx.rewards = ctx.rewards + 1 end }
			local first<const> = progression.compile_program({
				rules = {
					{ id = 'reward', on = 'reload.old', apply_once = true,
						set = { { key = 'kept', value = true }, { key = 'removed', value = true }, { key = 'false_value', value = false } },
						apply = { { op = 'reward' } } },
				}, filters = {}, handlers = handlers,
			})
			local ctx<const> = { rewards = 0 }
			local state<const> = progression.new_state(first)
			progression.mount(ctx, first, state)
			events:emit('reload.old', ctx, {})
			local second<const>, filters<const> = progression.compile_program({
				rules = {
					{ id = 'added', on = 'reload.new', set = { { key = 'added', value = true } }, apply = { { op = 'reward' } } },
					{ id = 'reward', on = 'reload.new', apply_once = true, apply = { { op = 'reward' } } },
				}, filters = { { { key = 'false_value', equals = false }, { key = 'kept', equals = true } } }, handlers = handlers,
			})
			assert(first.state_program.key2idx.kept ~= second.state_program.key2idx.kept, 'test must reorder compiled key slots')
			progression.rebind(ctx, second)
			assert(state.program == second.state_program and progression.matches(ctx, filters[1]), 'rebind must retain named values, including false')
			assert(state.program.key2idx.removed == nil and progression.get(ctx, 'added') == nil, 'new/deleted keys must not inherit old slots')
			events:emit('reload.old', ctx, {})
			assert(ctx.rewards == 1, 'old subscriptions survived rebind')
			events:emit('reload.new', ctx, {})
			assert(ctx.rewards == 2 and progression.get(ctx, 'added'), 'new subscriptions or once-only receipts were lost')
			local third<const> = progression.compile_program({ rules = {}, filters = {}, handlers = {} })
			progression.rebind(ctx, third)
			assert(next(state.values) == nil and next(state.apply_done) == nil, 'removed keys and rules must not remain as tombstones')
			progression.rebind(ctx, first)
			assert(progression.get(ctx, 'kept') == nil, 'reintroducing a removed key must not resurrect deleted state')
			events:emit('reload.old', ctx, {})
			assert(ctx.rewards == 3, 'reintroduced rule must start fresh')
			progression.unmount(ctx)
		end,
	},
}
