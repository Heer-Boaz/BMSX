-- Explicit 2D custom geometry. Nonspatial/3D custom renderers retain the
-- generic CustomVisualComponent and never acquire a fabricated Transform2D.
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local custom_visual_2d_component<const> = {}
custom_visual_2d_component.__index = custom_visual_2d_component
setmetatable(custom_visual_2d_component, { __index = visual_2d_component })

function custom_visual_2d_component.new(owner, configuration, id_local, defaults)
	local self<const>, input<const> = visual_2d_component.new(owner, configuration, id_local or 'visual', defaults)
	setmetatable(self, custom_visual_2d_component)
	self:set_draw_function(input.draw or (defaults and defaults.draw))
	return self
end

function custom_visual_2d_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	local default_id<const> = defaults.id_local
	return function(owner, configuration, id_local)
		return custom_visual_2d_component.new(owner, configuration, id_local or default_id, defaults)
	end
end

return custom_visual_2d_component
