local base_component<const> = require('cartlib/component/base_component')

local tile_collision_component<const> = {}
tile_collision_component.__index = tile_collision_component
tile_collision_component.unique = true
setmetatable(tile_collision_component, { __index = base_component })

function tile_collision_component.new(context, id_local)
	local local_id<const> = id_local or 'tile_collision'
	local input<const> = context.initial[local_id]
	local self<const> = setmetatable(base_component.new(context), tile_collision_component)
	self.id_local = local_id
	self.query = input.query
	self.event_base = input.event_base or 'tilecollision'
	self.begin_event_type = self.event_base .. '.begin'
	self.stay_event_type = self.event_base .. '.stay'
	self.end_event_type = self.event_base .. '.end'
	self.previous_collision_key = nil
	self.current_payload = {
		phase = false,
		component_id = false,
		component_local_id = false,
		collision_key = false,
	}
	self.previous_payload = {
		phase = false,
		component_id = false,
		component_local_id = false,
		collision_key = false,
	}
	return self
end

return tile_collision_component
