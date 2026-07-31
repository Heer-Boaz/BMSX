-- boundary.lua
-- boundary pipeline system.

local ecs<const> = require('cartlib/ecs/index')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local boundary_component_type<const> = component_types.screen_boundary
local prohibit_leaving_component_type<const> = component_types.prohibit_leaving_screen

local boundarysystem<const> = {}
boundarysystem.__index = boundarysystem
setmetatable(boundarysystem, { __index = ecsystem })

function boundarysystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), boundarysystem)
	return self
end

local emit_boundary_events<const> = function(obj, component)
	local left<const> = component.boundary_left
	local top<const> = component.boundary_top
	local right<const> = component.boundary_right
	local bottom<const> = component.boundary_bottom
	local oldx<const> = component.old_pos.x
	local oldy<const> = component.old_pos.y
	local newx<const> = obj.x
	local newy<const> = obj.y
	local sx<const> = obj.sx or 0
	local sy<const> = obj.sy or 0
	if newx < oldx then
		if newx + sx < left then
			obj.events:emit('screen.leave', { d = 'left', old_x_or_y = oldx })
		elseif newx < left then
			obj.events:emit('screen.leaving', { d = 'left', old_x_or_y = oldx })
		end
	elseif newx > oldx then
		if newx >= right then
			obj.events:emit('screen.leave', { d = 'right', old_x_or_y = oldx })
		elseif newx + sx > right then
			obj.events:emit('screen.leaving', { d = 'right', old_x_or_y = oldx })
		end
	end
	if newy < oldy then
		if newy + sy < top then
			obj.events:emit('screen.leave', { d = 'up', old_x_or_y = oldy })
		elseif newy < top then
			obj.events:emit('screen.leaving', { d = 'up', old_x_or_y = oldy })
		end
	elseif newy > oldy then
		if newy >= bottom then
			obj.events:emit('screen.leave', { d = 'down', old_x_or_y = oldy })
		elseif newy + sy > bottom then
			obj.events:emit('screen.leaving', { d = 'down', old_x_or_y = oldy })
		end
	end
end

function boundarysystem:update()
	local screen_boundary_components<const> = world_instance.active_space.active_components_by_type[boundary_component_type]
	for i = #screen_boundary_components, 1, -1 do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component)
	end
	local prohibit_leave_components<const> = world_instance.active_space.active_components_by_type[prohibit_leaving_component_type]
	for i = #prohibit_leave_components, 1, -1 do
		local component<const> = prohibit_leave_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component)
	end
end

return {
	id = 'boundary',
	group = tickgroup.physics,
	default_priority = 30,
	create = boundarysystem.new,
}
