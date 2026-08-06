-- btsystem.lua
-- Behaviour-tree ECS system.

local btcomponent<const> = require('cartlib/behaviourtree/btcomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local btsystem<const> = {}
btsystem.__index = btsystem
setmetatable(btsystem, { __index = basesystem })

function btsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.input, 0), btsystem)
	self._component_view = world:_active_component_view(btcomponent)
	return self
end

function btsystem:update()
	local components<const> = self._component_view.items
	for i = 1, #components do
		local component<const> = components[i]
		component.root:tick(component.parent, component)
	end
end

return btsystem
