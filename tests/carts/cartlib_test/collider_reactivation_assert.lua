local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')

local phases<const> = {}
local component_view<const> = { components = {} }
local test_world<const> = {}

function test_world:active_component_view(_component_class)
	return component_view
end

local observed_events<const> = {}
function observed_events:emit(_event_type, payload)
	phases[#phases + 1] = payload.phase
end

local ignored_events<const> = {}
function ignored_events:emit(_event_type, _payload)
end

local owner_a<const> = {
	id = 1,
	x = 32,
	y = 32,
	sx = 8,
	sy = 8,
	active = true,
	events = observed_events,
}
local owner_b<const> = {
	id = 2,
	x = 32,
	y = 32,
	sx = 8,
	sy = 8,
	active = true,
	events = ignored_events,
}
local collider_a<const> = collider_2d_component.new({
	parent = owner_a,
	id_local = 1,
	layer = 1,
	mask = 1,
})
local collider_b<const> = collider_2d_component.new({
	parent = owner_b,
	id_local = 1,
	layer = 1,
	mask = 1,
})
collider_a.id = 1
collider_b.id = 2
component_view.components[1] = collider_a
component_view.components[2] = collider_b

local overlap<const> = overlap_2d_system.new(test_world)

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
end

function __bmsx_host_test.update()
	overlap:update()
	assert(phases[1] == 'begin' and #phases == 1,
		'the first retained collider contact did not begin')

	overlap:update()
	assert(phases[2] == 'stay' and #phases == 2,
		'an unchanged retained collider contact did not stay')

	collider_a:set_enabled(false)
	collider_a:set_enabled(true)
	overlap:update()
	assert(phases[3] == 'end' and phases[4] == 'begin' and #phases == 4,
		'a reactivated collider did not end its old contact before beginning its new contact')

	overlap:update()
	assert(phases[5] == 'stay' and #phases == 5,
		'the replacement contact lifecycle did not become a retained stay')
	return true
end
