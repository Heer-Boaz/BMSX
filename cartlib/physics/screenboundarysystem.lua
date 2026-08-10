local screenboundarycomponent<const> = require('cartlib/physics/screenboundarycomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local screenboundarysystem<const> = {}
screenboundarysystem.__index = screenboundarysystem
setmetatable(screenboundarysystem, { __index = basesystem })

function screenboundarysystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.physics, 30), screenboundarysystem)
	self._component_view = world:active_component_view(screenboundarycomponent)
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

function screenboundarysystem:update()
	local event_payload<const> = self._event_payload
	local screen_boundary_components<const> = self._component_view.components
	for i = 1, #screen_boundary_components do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.parent
		emit_boundary_events(event_payload, obj, component)
	end
end

return screenboundarysystem
