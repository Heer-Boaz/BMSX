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

-- Compiles one static prefab constructor. Draw policy and structural defaults
-- are retained with the definition instead of rediscovered by every object.
function custom_visual_component.factory(definition)
	local draw<const> = definition.draw
	local id_local<const> = definition.id_local
	local enabled<const> = definition.enabled
	local offset_x<const> = definition.offset_x or 0
	local offset_y<const> = definition.offset_y or 0
	local offset_z<const> = definition.offset_z or 0
	return function(opts)
		local self<const> = create(opts, draw)
		self.id_local = id_local
		self.offset_x = offset_x
		self.offset_y = offset_y
		self.offset_z = offset_z
		if enabled ~= nil then
			self.enabled = enabled
		end
		return self
	end
end

return custom_visual_component
