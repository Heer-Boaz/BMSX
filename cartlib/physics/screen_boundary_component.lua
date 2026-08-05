local component<const> = require('cartlib/component/basecomponent')

local screen_boundary_component<const> = {}
screen_boundary_component.__index = screen_boundary_component
screen_boundary_component.unique = true
setmetatable(screen_boundary_component, { __index = component })

function screen_boundary_component.new(opts)
	local self<const> = setmetatable(component.new(opts), screen_boundary_component)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	return self
end

return screen_boundary_component
