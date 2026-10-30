local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')

local prohibit_leaving_screen_component<const> = {}
prohibit_leaving_screen_component.__index = prohibit_leaving_screen_component
setmetatable(prohibit_leaving_screen_component, { __index = screen_boundary_component })

function prohibit_leaving_screen_component.new(context, definition)
	local self<const> = setmetatable(screen_boundary_component.new(context, definition), prohibit_leaving_screen_component)
	self.stick_to_edge = true
	if definition ~= nil and definition.stick_to_edge ~= nil then
		self.stick_to_edge = definition.stick_to_edge
	end
	local initial<const> = context.initial[self.id_local]
	if initial ~= nil and initial.stick_to_edge ~= nil then
		self.stick_to_edge = initial.stick_to_edge
	end
	return self
end

function prohibit_leaving_screen_component.factory(definition)
	return function(context)
		return prohibit_leaving_screen_component.new(context, definition)
	end
end

function prohibit_leaving_screen_component:resolve_leaving(direction, previous_position, x, y)
	if direction == 'left' then
		x = self.stick_to_edge and (self.left - self._footprint_left) or previous_position
	elseif direction == 'right' then
		x = self.stick_to_edge and (self.right - self._footprint_right) or previous_position
	elseif direction == 'up' then
		y = self.stick_to_edge and (self.top - self._footprint_top) or previous_position
	else
		y = self.stick_to_edge and (self.bottom - self._footprint_bottom) or previous_position
	end
	return self._write_world_origin(self.spatial, x, y)
end

return prohibit_leaving_screen_component
