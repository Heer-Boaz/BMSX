local component<const> = require('cartlib/world/component')

local prohibitleavingscreencomponent<const> = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
prohibitleavingscreencomponent.type_name = 'prohibitleavingscreencomponent'
setmetatable(prohibitleavingscreencomponent, { __index = component })

function prohibitleavingscreencomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, prohibitleavingscreencomponent.type_name, true), prohibitleavingscreencomponent)
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
