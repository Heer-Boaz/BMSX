local component<const> = require('cartlib/world/component')
local empty_options<const> = {}

local visualcomponent<const> = {}
visualcomponent.__index = visualcomponent
visualcomponent.is_visual = true
setmetatable(visualcomponent, { __index = component })

function visualcomponent.new(opts, type_name)
	opts = opts or empty_options
	local self<const> = setmetatable(component.new(opts, type_name), visualcomponent)
	self.offset_x = opts.offset_x or 0
	self.offset_y = opts.offset_y or 0
	self.offset_z = opts.offset_z or 0
	self.draw_offset_x = opts.draw_offset_x or 0
	self.draw_offset_y = opts.draw_offset_y or 0
	self.draw_offset_z = opts.draw_offset_z or 0
	self.visible = opts.visible == nil or opts.visible
	return self
end

return visualcomponent
