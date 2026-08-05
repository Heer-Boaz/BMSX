-- screen_boundary.lua
-- Screen-boundary ECS system.

local prohibit_leaving_screen_component<const> = require('cartlib/physics/prohibit_leaving_screen_component')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
local system<const> = require('cartlib/world/system')
local tick_group<const> = require('cartlib/world/tick_group')


local boundary_component_type<const> = screen_boundary_component.type_name
local prohibit_leaving_component_type<const> = prohibit_leaving_screen_component.type_name

local screen_boundary_system<const> = {}
screen_boundary_system.__index = screen_boundary_system
setmetatable(screen_boundary_system, { __index = system })

function screen_boundary_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.physics, 30), screen_boundary_system)
	self._boundary_component_view = world:_active_component_view(boundary_component_type)
	self._prohibit_leaving_component_view = world:_active_component_view(prohibit_leaving_component_type)
	return self
end

local emit_boundary_events<const> = function(obj, component, prohibit_leaving)
	local left<const> = component.left
	local top<const> = component.top
	local right<const> = component.right
	local bottom<const> = component.bottom
	local oldx<const> = component.old_x
	local oldy<const> = component.old_y
	local newx<const> = obj.x
	local newy<const> = obj.y
	local sx<const> = obj.sx
	local sy<const> = obj.sy
	if newx < oldx then
		if newx + sx < left then
			obj.events:emit('screen.leave', { d = 'left', old_x_or_y = oldx })
		elseif newx < left then
			if prohibit_leaving then
				obj.x = component.stick_to_edge and left or oldx
			end
			obj.events:emit('screen.leaving', { d = 'left', old_x_or_y = oldx })
		end
	elseif newx > oldx then
		if newx >= right then
			obj.events:emit('screen.leave', { d = 'right', old_x_or_y = oldx })
		elseif newx + sx > right then
			if prohibit_leaving then
				obj.x = component.stick_to_edge and (right - sx) or oldx
			end
			obj.events:emit('screen.leaving', { d = 'right', old_x_or_y = oldx })
		end
	end
	if newy < oldy then
		if newy + sy < top then
			obj.events:emit('screen.leave', { d = 'up', old_x_or_y = oldy })
		elseif newy < top then
			if prohibit_leaving then
				obj.y = component.stick_to_edge and top or oldy
			end
			obj.events:emit('screen.leaving', { d = 'up', old_x_or_y = oldy })
		end
	elseif newy > oldy then
		if newy >= bottom then
			obj.events:emit('screen.leave', { d = 'down', old_x_or_y = oldy })
		elseif newy + sy > bottom then
			if prohibit_leaving then
				obj.y = component.stick_to_edge and (bottom - sy) or oldy
			end
			obj.events:emit('screen.leaving', { d = 'down', old_x_or_y = oldy })
		end
	end
end

function screen_boundary_system:update()
	local screen_boundary_components<const> = self._boundary_component_view.items
	for i = #screen_boundary_components, 1, -1 do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component, false)
	end
	local prohibit_leave_components<const> = self._prohibit_leaving_component_view.items
	for i = #prohibit_leave_components, 1, -1 do
		local component<const> = prohibit_leave_components[i]
		local obj<const> = component.parent
		emit_boundary_events(obj, component, true)
	end
end

return screen_boundary_system
