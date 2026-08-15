local visual_component<const> = require('cartlib/component/visual_component')

local custom_visual_component<const> = {}
custom_visual_component.__index = custom_visual_component
setmetatable(custom_visual_component, { __index = visual_component })

function custom_visual_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), custom_visual_component)
	self.producer = opts.producer
	self:set_draw_function(custom_visual_component.draw_visual)
	return self
end

function custom_visual_component:draw_visual(draw)
	self.producer(self.parent, draw)
end

return custom_visual_component
