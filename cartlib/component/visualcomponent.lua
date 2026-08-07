local basecomponent<const> = require('cartlib/component/basecomponent')

local visualcomponent<const> = {}
visualcomponent.__index = visualcomponent
visualcomponent.is_visual = true
setmetatable(visualcomponent, { __index = basecomponent })

function visualcomponent.new(opts)
	local self<const> = setmetatable(basecomponent.new(opts), visualcomponent)
	self.offset_x = opts.offset_x or 0
	self.offset_y = opts.offset_y or 0
	self.offset_z = opts.offset_z or 0
	self.draw_offset_x = opts.draw_offset_x or 0
	self.draw_offset_y = opts.draw_offset_y or 0
	self.draw_offset_z = opts.draw_offset_z or 0
	self.visible = opts.visible == nil or opts.visible
	return self
end

function visualcomponent:set_offset_z(offset_z)
	self.offset_z = offset_z
	if self._attached and self.parent._worldobject_index ~= nil then
		self.parent.world:visual_depth_changed()
	end
end

function visualcomponent:set_draw_offset_z(draw_offset_z)
	self.draw_offset_z = draw_offset_z
	if self._attached and self.parent._worldobject_index ~= nil then
		self.parent.world:visual_depth_changed()
	end
end

return visualcomponent
