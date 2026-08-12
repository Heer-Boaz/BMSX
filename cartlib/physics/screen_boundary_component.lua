local base_component<const> = require('cartlib/component/base_component')

local screen_boundary_component<const> = {}
screen_boundary_component.__index = screen_boundary_component
screen_boundary_component.unique = true
setmetatable(screen_boundary_component, { __index = base_component })

function screen_boundary_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), screen_boundary_component)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	return self
end

function screen_boundary_component:resolve_leaving(_direction, _previous_position)
end

return screen_boundary_component
