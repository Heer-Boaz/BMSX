local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local prohibitleavingscreencomponent<const> = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
setmetatable(prohibitleavingscreencomponent, { __index = component })

function prohibitleavingscreencomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.prohibit_leaving_screen, true), prohibitleavingscreencomponent)
	self.old_x = 0
	self.old_y = 0
	self.left = opts.left
	self.top = opts.top
	self.right = opts.right
	self.bottom = opts.bottom
	self.stick_to_edge = opts.stick_to_edge == nil or opts.stick_to_edge
	return self
end

return prohibitleavingscreencomponent
