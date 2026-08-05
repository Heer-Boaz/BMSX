local visualcomponent<const> = require('cartlib/render/visual_component')

local customvisualcomponent<const> = {}
customvisualcomponent.__index = customvisualcomponent
customvisualcomponent.type_name = 'customvisualcomponent'
setmetatable(customvisualcomponent, { __index = visualcomponent })

function customvisualcomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, customvisualcomponent.type_name), customvisualcomponent)
	self.producer = opts.producer
	return self
end

function customvisualcomponent:draw(draw)
	self.producer(self.parent, draw)
end

return customvisualcomponent
