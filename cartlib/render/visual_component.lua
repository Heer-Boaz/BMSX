local component<const> = require('cartlib/world/component')
local empty_options<const> = {}

local visual_component<const> = {}
visual_component.__index = visual_component
visual_component.is_visual = true
setmetatable(visual_component, { __index = component })

function visual_component.new(opts, type_name)
	opts = opts or empty_options
	local self<const> = setmetatable(component.new(opts, type_name), visual_component)
	self.offset_x = opts.offset_x or 0
	self.offset_y = opts.offset_y or 0
	self.offset_z = opts.offset_z or 0
	self.draw_offset_x = opts.draw_offset_x or 0
	self.draw_offset_y = opts.draw_offset_y or 0
	self.draw_offset_z = opts.draw_offset_z or 0
	self.visible = opts.visible == nil or opts.visible
	return self
end

function visual_component:set_offset_z(offset_z)
	self.offset_z = offset_z
	if self._published then
		self.parent.world:visual_depth_changed()
	end
end

function visual_component:set_draw_offset_z(draw_offset_z)
	self.draw_offset_z = draw_offset_z
	if self._published then
		self.parent.world:visual_depth_changed()
	end
end

return visual_component
