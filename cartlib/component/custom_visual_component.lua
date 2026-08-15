local visual_component<const> = require('cartlib/component/visual_component')

local custom_visual_component<const> = {}
custom_visual_component.__index = custom_visual_component
setmetatable(custom_visual_component, { __index = visual_component })

-- `draw(component, draw_list)` is the retained visual datapath. The callback
-- receives this component directly, so custom visuals do not allocate a bound
-- closure or forward through a second per-frame producer call.
function custom_visual_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), custom_visual_component)
	self:set_draw_function(opts.draw)
	return self
end

return custom_visual_component
