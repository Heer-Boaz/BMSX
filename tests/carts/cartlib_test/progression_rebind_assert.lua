local progression<const> = require('cartlib/progression')
local events<const> = require('cartlib/event_emitter')

__bmsx_host_test = {}
function __bmsx_host_test.ready() return cartlib_test_ready end
function __bmsx_host_test.setup()
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
end
function __bmsx_host_test.update() return true end
