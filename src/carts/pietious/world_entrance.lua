local world_entrance_sprite_ids = {
	closed = 'world_entrance',
	opening_1 = 'world_entrance',
	opening_2 = 'world_entrance_half_open',
	open = 'world_entrance_open',
}

local world_entrance = {}
world_entrance.__index = world_entrance

function world_entrance:set_entrance_state(entrance_state)
	self.entrance_state = entrance_state
	self:gfx(world_entrance_sprite_ids[entrance_state])
end

function world_entrance:ctor()
	self.collider.enabled = false
	self:gfx('world_entrance')
end

local function define_world_entrance_fsm()
	define_fsm('world_entrance', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_world_entrance_definition()
	define_prefab({
		def_id = 'world_entrance',
		class = world_entrance,
		type = 'sprite',
		fsms = { 'world_entrance' },
		defaults = {
			target = nil,
			tick_enabled = false,
		},
	})
end

return {
	define_world_entrance_fsm = define_world_entrance_fsm,
	register_world_entrance_definition = register_world_entrance_definition,
}
