-- Captures positions before gameplay movement for screen-boundary resolution.

local screenboundarycomponent<const> = require('cartlib/physics/screenboundarycomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local screenboundarycapturesystem<const> = {}
screenboundarycapturesystem.__index = screenboundarycapturesystem
setmetatable(screenboundarycapturesystem, { __index = basesystem })

function screenboundarycapturesystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.input, -100), screenboundarycapturesystem)
	self._component_view = world:_active_component_view(screenboundarycomponent)
	return self
end

function screenboundarycapturesystem:update()
	local boundary_components<const> = self._component_view.items
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
end

return screenboundarycapturesystem
