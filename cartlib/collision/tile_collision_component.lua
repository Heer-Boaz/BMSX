local base_component<const> = require('cartlib/component/base_component')

local tile_collision_component<const> = {}
tile_collision_component.__index = tile_collision_component
tile_collision_component.unique = true
setmetatable(tile_collision_component, { __index = base_component })

function tile_collision_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), tile_collision_component)
	self.query = opts.query
	self.event_base = opts.event_base or 'tilecollision'
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
