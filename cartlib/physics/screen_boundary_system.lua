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
	self._event_payload = { direction = false, previous_position = 0, correction_committed = true }
	return self
end

-- Correction and notification are one synchronous event boundary. A callback
-- can move the body or change its basis; subsequent edge decisions consume
-- that current pose, not coordinates captured before the callback.
local dispatch_boundary_event<const> = function(payload, component, correcting, direction, old_position, x, y)
	local obj<const> = component.owner
	if correcting then
		component.correction_committed = component:resolve_leaving(direction, old_position, x, y)
		if obj.marked_for_disposal then
			return false
		end
	else
		component.correction_committed = true
	end
	payload.direction = direction
	payload.previous_position = old_position
	payload.correction_committed = component.correction_committed
	obj.events:emit(correcting and 'screen.leaving' or 'screen.leave', payload)
	return not obj.marked_for_disposal
end

local emit_boundary_events<const> = function(payload, obj, component)
	if obj.marked_for_disposal then
		return
	end
	local left<const> = component.left
	local top<const> = component.top
	local right<const> = component.right
	local bottom<const> = component.bottom
	local spatial<const> = component:resolve_footprint()
	local x, y = spatial.wox, spatial.woy
	local edge = x + component._footprint_left
	if edge < component.old_left and edge < left then
		if not dispatch_boundary_event(payload, component,
			x + component._footprint_right >= left, 'left', component.old_x, x, y) then return end
		component:resolve_footprint()
		x, y = spatial.wox, spatial.woy
	end
	edge = x + component._footprint_right
	if edge > component.old_right and (edge > right or x + component._footprint_left >= right) then
		if not dispatch_boundary_event(payload, component,
			x + component._footprint_left < right, 'right', component.old_x, x, y) then return end
		component:resolve_footprint()
		x, y = spatial.wox, spatial.woy
	end
	edge = y + component._footprint_top
	if edge < component.old_top and edge < top then
		if not dispatch_boundary_event(payload, component,
			y + component._footprint_bottom >= top, 'up', component.old_y, x, y) then return end
		component:resolve_footprint()
		x, y = spatial.wox, spatial.woy
	end
	edge = y + component._footprint_bottom
	if edge > component.old_bottom and (edge > bottom or y + component._footprint_top >= bottom) then
		dispatch_boundary_event(payload, component,
			y + component._footprint_top < bottom, 'down', component.old_y, x, y)
	end
end

function screen_boundary_system:update()
	local event_payload<const> = self._event_payload
	local screen_boundary_components<const> = self._component_view.components
	for i = 1, #screen_boundary_components do
		local component<const> = screen_boundary_components[i]
		local obj<const> = component.owner
		emit_boundary_events(event_payload, obj, component)
	end
end

return screen_boundary_system
