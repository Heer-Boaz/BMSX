-- Captures positions before gameplay movement for screen-boundary resolution.

local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
local base_system<const> = require('cartlib/world/base_system')
local tick_group<const> = require('cartlib/world/tick_group')


local screen_boundary_capture_system<const> = {}
screen_boundary_capture_system.__index = screen_boundary_capture_system
setmetatable(screen_boundary_capture_system, { __index = base_system })

function screen_boundary_capture_system.new(world)
	local self<const> = setmetatable(base_system.new(tick_group.input, -100), screen_boundary_capture_system)
	self._component_view = world:active_component_view(screen_boundary_component)
	return self
end

function screen_boundary_capture_system:update()
	local boundary_components<const> = self._component_view.components
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
end

return screen_boundary_capture_system
