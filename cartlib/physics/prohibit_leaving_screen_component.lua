local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')

local prohibit_leaving_screen_component<const> = {}
prohibit_leaving_screen_component.__index = prohibit_leaving_screen_component
setmetatable(prohibit_leaving_screen_component, { __index = screen_boundary_component })

function prohibit_leaving_screen_component.new(opts)
	local self<const> = setmetatable(screen_boundary_component.new(opts), prohibit_leaving_screen_component)
	self.stick_to_edge = opts.stick_to_edge == nil or opts.stick_to_edge
	return self
end

function prohibit_leaving_screen_component:resolve_leaving(direction, previous_position)
	local owner<const> = self.parent
	if direction == 'left' then
		owner.x = self.stick_to_edge and self.left or previous_position
	elseif direction == 'right' then
		owner.x = self.stick_to_edge and (self.right - owner.sx) or previous_position
	elseif direction == 'up' then
		owner.y = self.stick_to_edge and self.top or previous_position
	else
		owner.y = self.stick_to_edge and (self.bottom - owner.sy) or previous_position
	end
end

return prohibit_leaving_screen_component
