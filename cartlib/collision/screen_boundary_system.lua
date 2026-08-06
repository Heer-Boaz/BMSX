-- screen_boundary.lua
-- Screen-boundary ECS system.

local prohibit_leaving_screen_component<const> = require('cartlib/physics/prohibit_leaving_screen_component')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')


local screen_boundary_system<const> = {}
screen_boundary_system.__index = screen_boundary_system
setmetatable(screen_boundary_system, { __index = system })

function screen_boundary_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.physics, 30), screen_boundary_system)
	self._boundary_component_view = world:_active_component_view(screen_boundary_component)
	self._prohibit_leaving_component_view = world:_active_component_view(prohibit_leaving_screen_component)
	-- Boundary payloads are synchronous system scratch, like overlap payloads.
	-- Handlers consume their fields during dispatch rather than retaining them.
	self._event_payload = { d = false, old_x_or_y = 0 }
	return self
end

local emit_boundary_event<const> = function(payload, obj, event_type, direction, old_position)
	payload.d = direction
	payload.old_x_or_y = old_position
	obj.events:emit(event_type, payload)
end

local emit_boundary_events<const> = function(payload, obj, component, prohibit_leaving)
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
			emit_boundary_event(payload, obj, 'screen.leave', 'left', oldx)
		elseif newx < left then
			if prohibit_leaving then
				obj.x = component.stick_to_edge and left or oldx
			end
			emit_boundary_event(payload, obj, 'screen.leaving', 'left', oldx)
		end
	elseif newx > oldx then
		if newx >= right then
			emit_boundary_event(payload, obj, 'screen.leave', 'right', oldx)
		elseif newx + sx > right then
			if prohibit_leaving then
				obj.x = component.stick_to_edge and (right - sx) or oldx
			end
			emit_boundary_event(payload, obj, 'screen.leaving', 'right', oldx)
		end
	end
	if newy < oldy then
		if newy + sy < top then
			emit_boundary_event(payload, obj, 'screen.leave', 'up', oldy)
		elseif newy < top then
			if prohibit_leaving then
				obj.y = component.stick_to_edge and top or oldy
			end
			emit_boundary_event(payload, obj, 'screen.leaving', 'up', oldy)
		end
	elseif newy > oldy then
		if newy >= bottom then
			emit_boundary_event(payload, obj, 'screen.leave', 'down', oldy)
		elseif newy + sy > bottom then
			if prohibit_leaving then
				obj.y = component.stick_to_edge and (bottom - sy) or oldy
			end
			emit_boundary_event(payload, obj, 'screen.leaving', 'down', oldy)
		end
	end
end

function screen_boundary_system:update()
	local event_payload<const> = self._event_payload
	local screen_boundary_components<const> = self._boundary_component_view.items
	for i = #screen_boundary_components, 1, -1 do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(event_payload, obj, component, false)
	end
	local prohibit_leave_components<const> = self._prohibit_leaving_component_view.items
	for i = #prohibit_leave_components, 1, -1 do
		local component<const> = prohibit_leave_components[i]
		local obj<const> = component.parent
		emit_boundary_events(event_payload, obj, component, true)
	end
end

return screen_boundary_system
