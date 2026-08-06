local screenboundarycomponent<const> = require('cartlib/physics/screenboundarycomponent')

local prohibitleavingscreencomponent<const> = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
setmetatable(prohibitleavingscreencomponent, { __index = screenboundarycomponent })

function prohibitleavingscreencomponent.new(opts)
	local self<const> = setmetatable(screenboundarycomponent.new(opts), prohibitleavingscreencomponent)
	self.stick_to_edge = opts.stick_to_edge == nil or opts.stick_to_edge
	return self
end

function prohibitleavingscreencomponent:resolve_leaving(direction, previous_position)
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

return prohibitleavingscreencomponent
