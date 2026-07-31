local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local tilecollisioncomponent<const> = {}
tilecollisioncomponent.__index = tilecollisioncomponent
setmetatable(tilecollisioncomponent, { __index = component })

function tilecollisioncomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.tile_collision, true), tilecollisioncomponent)
	self.query = opts.query
	self.event_base = opts.event_base or 'tilecollision'
	self.previous_collision_key = nil
	self.current_payload = {}
	self.previous_payload = {}
	self._event = {}
	return self
end

return tilecollisioncomponent
