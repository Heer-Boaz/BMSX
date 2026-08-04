-- screen_boundary_capture.lua
-- Captures positions before gameplay movement for screen-boundary resolution.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system

local screen_boundary_type<const> = component_types.screen_boundary
local prohibit_leaving_screen_type<const> = component_types.prohibit_leaving_screen

local screen_boundary_capture_system<const> = {}
screen_boundary_capture_system.__index = screen_boundary_capture_system
screen_boundary_capture_system.component_types = {
	screen_boundary_type,
	prohibit_leaving_screen_type,
}
setmetatable(screen_boundary_capture_system, { __index = system })

function screen_boundary_capture_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.input, priority or -100), screen_boundary_capture_system)
	return self
end

function screen_boundary_capture_system:update()
	local boundary_components<const> = world.active_space.active_components_by_type[screen_boundary_type]
	for i = 1, #boundary_components do
		local component<const> = boundary_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
	local prohibit_components<const> = world.active_space.active_components_by_type[prohibit_leaving_screen_type]
	for i = 1, #prohibit_components do
		local component<const> = prohibit_components[i]
		local parent<const> = component.parent
		component.old_x = parent.x
		component.old_y = parent.y
	end
end

return screen_boundary_capture_system.new
