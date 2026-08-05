-- btsystem.lua
-- Behaviour-tree ECS system.

local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')

local btsystem<const> = {}
btsystem.__index = btsystem
setmetatable(btsystem, { __index = system })

function btsystem.new(world)
	local self<const> = setmetatable(system.new(tick_group.input, 0), btsystem)
	self._component_view = world:_active_component_view(bt_component)
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
