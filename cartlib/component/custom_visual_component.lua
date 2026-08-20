local visual_component<const> = require('cartlib/component/visual_component')

local custom_visual_component<const> = {}
custom_visual_component.__index = custom_visual_component
setmetatable(custom_visual_component, { __index = visual_component })

local create<const> = function(opts, draw)
	local self<const> = setmetatable(visual_component.new(opts), custom_visual_component)
	self:set_draw_function(draw)
	return self
end

-- `draw(component, draw_list)` is the retained visual datapath. The callback
-- receives this component directly, so custom visuals do not allocate a bound
-- closure or forward through a second per-frame producer call.
function custom_visual_component.new(opts)
	return create(opts, opts.draw)
end

-- Compiles one static prefab constructor. The draw datapath is captured once
-- with the definition instead of being discovered and rebound by every object
-- constructor.
function custom_visual_component.factory(draw)
	return function(opts)
		return create(opts, draw)
	end
end

return custom_visual_component
