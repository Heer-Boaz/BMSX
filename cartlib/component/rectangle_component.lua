local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local affine_batch<const> = require('cartlib/gx/affine_batch')

local rectangle_component<const> = {}
rectangle_component.__index = rectangle_component
setmetatable(rectangle_component, { __index = visual_2d_component })

function rectangle_component.new(context)
	local self<const>, input<const> = visual_2d_component.new(context, 'rectangle')
	setmetatable(self, rectangle_component)
	self.width, self.height, self.color = input.width, input.height, input.color
	self:set_draw_function(rectangle_component.draw_rectangle)
	return self
end

function rectangle_component:draw_rectangle(draw)
	self:resolve_pose()
	affine_batch.rect(draw, 0, 0, self.width, self.height,
		self.wxx, self.wxy, self.wyx, self.wyy, self.wox, self.woy, self.color)
end

return rectangle_component
