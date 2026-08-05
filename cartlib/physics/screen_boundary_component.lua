local component<const> = require('cartlib/world/component')

local screenboundarycomponent<const> = {}
screenboundarycomponent.__index = screenboundarycomponent
screenboundarycomponent.type_name = 'screenboundarycomponent'
setmetatable(screenboundarycomponent, { __index = component })

function screenboundarycomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, screenboundarycomponent.type_name, true), screenboundarycomponent)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	return self
end

return screenboundarycomponent
