local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')


local screen_boundary_system<const> = {}
screen_boundary_system.__index = screen_boundary_system
setmetatable(screen_boundary_system, { __index = base_system })
screen_boundary_system.tick = {
	group = tick_group.physics,
	priority = 30,
	clock_source = clock.gameplay,
	method = 'update',
}

function screen_boundary_system.new(world)
	local self<const> = setmetatable(base_system.new(screen_boundary_system.tick), screen_boundary_system)
	self._component_view = world:active_component_view(screen_boundary_component)
	-- Boundary payloads are synchronous system scratch, like overlap payloads.
	-- Handlers consume their fields during dispatch rather than retaining them.
	self._event_payload = { direction = false, previous_position = 0 }
	return self
end

local emit_boundary_event<const> = function(payload, obj, event_type, direction, old_position)
	payload.direction = direction
	payload.previous_position = old_position
	obj.events:emit(event_type, payload)
end

local emit_boundary_events<const> = function(payload, obj, component)
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
			component:resolve_leaving('left', oldx)
			emit_boundary_event(payload, obj, 'screen.leaving', 'left', oldx)
		end
	elseif newx > oldx then
		if newx >= right then
			emit_boundary_event(payload, obj, 'screen.leave', 'right', oldx)
		elseif newx + sx > right then
			component:resolve_leaving('right', oldx)
			emit_boundary_event(payload, obj, 'screen.leaving', 'right', oldx)
		end
	end
	if newy < oldy then
		if newy + sy < top then
			emit_boundary_event(payload, obj, 'screen.leave', 'up', oldy)
		elseif newy < top then
			component:resolve_leaving('up', oldy)
			emit_boundary_event(payload, obj, 'screen.leaving', 'up', oldy)
		end
	elseif newy > oldy then
		if newy >= bottom then
			emit_boundary_event(payload, obj, 'screen.leave', 'down', oldy)
		elseif newy + sy > bottom then
			component:resolve_leaving('down', oldy)
			emit_boundary_event(payload, obj, 'screen.leaving', 'down', oldy)
		end
	end
end

function screen_boundary_system:update()
	local event_payload<const> = self._event_payload
	local screen_boundary_components<const> = self._component_view.components
	for i = 1, #screen_boundary_components do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(event_payload, obj, component)
	end
end

return screen_boundary_system
