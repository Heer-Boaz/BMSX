local component<const> = require('cartlib/world/component')

local tilecollisioncomponent<const> = {}
tilecollisioncomponent.__index = tilecollisioncomponent
tilecollisioncomponent.type_name = 'tilecollisioncomponent'
setmetatable(tilecollisioncomponent, { __index = component })

function tilecollisioncomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, tilecollisioncomponent.type_name, true), tilecollisioncomponent)
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

return tilecollisioncomponent
