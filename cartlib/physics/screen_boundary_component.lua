local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local screenboundarycomponent<const> = {}
screenboundarycomponent.__index = screenboundarycomponent
setmetatable(screenboundarycomponent, { __index = component })

function screenboundarycomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.screen_boundary, true), screenboundarycomponent)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	return self
end

return screenboundarycomponent
