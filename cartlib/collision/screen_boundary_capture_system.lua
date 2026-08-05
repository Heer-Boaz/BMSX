-- screen_boundary_capture.lua
-- Captures positions before gameplay movement for screen-boundary resolution.

local component_types<const> = require('cartlib/components/types')
local system_module<const> = require('cartlib/world/system')

local tick_group<const> = system_module.tick_group
local system<const> = system_module.system

local screen_boundary_type<const> = component_types.screen_boundary
local prohibit_leaving_screen_type<const> = component_types.prohibit_leaving_screen

local screen_boundary_capture_system<const> = {}
screen_boundary_capture_system.__index = screen_boundary_capture_system
setmetatable(screen_boundary_capture_system, { __index = system })

function screen_boundary_capture_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.input, -100), screen_boundary_capture_system)
	self.boundary_components = world:_active_component_view(screen_boundary_type)
	self.prohibit_components = world:_active_component_view(prohibit_leaving_screen_type)
	return self
end

function screen_boundary_capture_system:update()
	local boundary_components<const> = self.boundary_components.items
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
	local prohibit_components<const> = self.prohibit_components.items
	for i = 1, #prohibit_components do
		local component<const> = prohibit_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
end

return screen_boundary_capture_system
