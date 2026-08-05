local component<const> = require('cartlib/world/component')

local prohibit_leaving_screen_component<const> = {}
prohibit_leaving_screen_component.__index = prohibit_leaving_screen_component
prohibit_leaving_screen_component.type_name = 'prohibit_leaving_screen_component'
setmetatable(prohibit_leaving_screen_component, { __index = component })

function prohibit_leaving_screen_component.new(opts)
	local self<const> = setmetatable(component.new(opts, prohibit_leaving_screen_component.type_name, true), prohibit_leaving_screen_component)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	self.stick_to_edge = opts.stick_to_edge == nil or opts.stick_to_edge
	return self
end

return prohibit_leaving_screen_component
