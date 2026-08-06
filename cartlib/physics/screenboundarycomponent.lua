local basecomponent<const> = require('cartlib/component/basecomponent')

local screenboundarycomponent<const> = {}
screenboundarycomponent.__index = screenboundarycomponent
screenboundarycomponent.unique = true
setmetatable(screenboundarycomponent, { __index = basecomponent })

function screenboundarycomponent.new(opts)
	local self<const> = setmetatable(basecomponent.new(opts), screenboundarycomponent)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	return self
end

function screenboundarycomponent:resolve_leaving(_direction, _previous_position)
end

return screenboundarycomponent
