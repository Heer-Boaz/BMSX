-- screen_boundary_capture.lua
-- Captures positions before gameplay movement for screen-boundary resolution.

local prohibit_leaving_screen_component<const> = require('cartlib/physics/prohibit_leaving_screen_component')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')


local screen_boundary_capture_system<const> = {}
screen_boundary_capture_system.__index = screen_boundary_capture_system
setmetatable(screen_boundary_capture_system, { __index = system })

function screen_boundary_capture_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.input, -100), screen_boundary_capture_system)
	self._boundary_component_view = world:_active_component_view(screen_boundary_component)
	self._prohibit_leaving_component_view = world:_active_component_view(prohibit_leaving_screen_component)
	return self
end

function screen_boundary_capture_system:update()
	local boundary_components<const> = self._boundary_component_view.items
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
	local prohibit_components<const> = self._prohibit_leaving_component_view.items
	for i = 1, #prohibit_components do
		local component<const> = prohibit_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
end

return screen_boundary_capture_system
