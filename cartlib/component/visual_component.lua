local base_component<const> = require('cartlib/component/base_component')

local visual_component<const> = {}
visual_component.__index = visual_component
visual_component.is_visual = true
setmetatable(visual_component, { __index = base_component })

function visual_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), visual_component)
	self.draw = nil
	self.offset_x = opts.offset_x or 0
	self.offset_y = opts.offset_y or 0
	self.offset_z = opts.offset_z or 0
	self.draw_offset_x = opts.draw_offset_x or 0
	self.draw_offset_y = opts.draw_offset_y or 0
	self.draw_offset_z = opts.draw_offset_z or 0
	self.visible = opts.visible == nil or opts.visible
	return self
end

-- Visual producers publish their retained draw datapath directly. A nil
-- datapath means that the attached component has no current render work; it
-- remains enabled and queryable but does not enter the space's visual view.
function visual_component:set_draw_function(draw_function)
	if self.draw == draw_function then
		return self
	end
	self.draw = draw_function
	if self._active_space ~= nil then
		self.parent.world:reconcile_component(self)
	end
	return self
end

function visual_component:set_offset_z(offset_z)
	self.offset_z = offset_z
	if self._attached and self.parent._world_object_index ~= nil then
		self.parent.world:visual_depth_changed()
	end
end

function visual_component:set_draw_offset_z(draw_offset_z)
	self.draw_offset_z = draw_offset_z
	if self._attached and self.parent._world_object_index ~= nil then
		self.parent.world:visual_depth_changed()
	end
end

return visual_component
