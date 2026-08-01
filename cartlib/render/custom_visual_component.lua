local component_types<const> = require('cartlib/components/types')
local visualcomponent<const> = require('cartlib/render/visual_component')

local customvisualcomponent<const> = {}
customvisualcomponent.__index = customvisualcomponent
setmetatable(customvisualcomponent, { __index = visualcomponent })

function customvisualcomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, component_types.custom_visual), customvisualcomponent)
	self.producer = opts.producer
	return self
end

function customvisualcomponent:draw(draw)
	self.producer(self.parent, draw)
end

return customvisualcomponent
