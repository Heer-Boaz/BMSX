local compile_matcher<const> = require('cartlib/event_matcher').compile

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	assert(compile_matcher(nil)(nil))
	assert(compile_matcher({})(nil))

	local equals<const> = compile_matcher({
		equals = { event = 'hit', count = 2 },
	})
	assert(equals({ event = 'hit', count = 2 }))
	assert(not equals({ event = 'hit', count = 3 }))
	assert(not equals(nil))

	local any<const> = compile_matcher({
		any_of = { state = { 'idle', 'active' } },
		['in'] = { source = { 'player', 'party' } },
	})
	assert(any({ state = 'active', source = 'player' }))
	assert(any({ state = { 'sleeping', 'active' }, source = { 'enemy', 'party' } }))
	assert(not any({ state = 'sleeping', source = 'player' }))

	local tags<const> = compile_matcher({ has_tag = { 'combat', 'boss' } })
	assert(tags({ tags = { 'boss', 'combat', 'phase2' } }))
	assert(not tags({ tags = { 'combat' } }))
	assert(not tags({}))

	local composed<const> = compile_matcher({
		equals = { event = 'damage' },
		['and'] = {
			{ ['in'] = { status = { 'applied', 'blocked' } } },
		},
		['not'] = { equals = { ignored = true } },
		['or'] = {
			{ equals = { kind = 'enemy' } },
			{ has_tag = { 'targetable' } },
		},
	})
	assert(composed({ event = 'damage', status = 'applied', kind = 'enemy' }))
	assert(composed({ event = 'damage', status = 'blocked', tags = { 'targetable' } }))
	assert(not composed({ event = 'damage', status = 'missed', kind = 'enemy' }))
	assert(not composed({ event = 'damage', status = 'applied', kind = 'enemy', ignored = true }))
	assert(not composed({ event = 'heal', status = 'applied', kind = 'enemy' }))

	local short_circuit<const> = compile_matcher({
		['or'] = {
			{},
			{ equals = { event = 'unused' } },
		},
	})
	assert(short_circuit(nil))
end

function __bmsx_host_test.update()
	return true
end
