local visual_component<const> = require('cartlib/component/visual_component')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local custom_visual_component<const> = {}
custom_visual_component.__index = custom_visual_component
setmetatable(custom_visual_component, { __index = visual_component })

-- `draw(component, draw_list)` is the retained visual datapath. The callback
-- receives this component directly, so custom visuals do not allocate a bound
-- closure or forward through a second per-frame producer call.
function custom_visual_component.new(context, id_local, defaults)
	local self<const>, input<const> = visual_component.new(context, id_local or 'visual', defaults)
	setmetatable(self, custom_visual_component)
	self:set_draw_function(input.draw or (defaults and defaults.draw))
	return self
end

-- Compiles one static prefab constructor. Draw policy and structural defaults
-- are retained with the definition instead of rediscovered by every object.
function custom_visual_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	local default_id<const> = defaults.id_local
	return function(context, id_local)
		return custom_visual_component.new(context, id_local or default_id, defaults)
	end
end

return custom_visual_component
