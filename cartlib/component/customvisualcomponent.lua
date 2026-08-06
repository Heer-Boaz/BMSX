local visualcomponent<const> = require('cartlib/component/visualcomponent')

local customvisualcomponent<const> = {}
customvisualcomponent.__index = customvisualcomponent
setmetatable(customvisualcomponent, { __index = visualcomponent })

function customvisualcomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts), customvisualcomponent)
	self.producer = opts.producer
	return self
end

function customvisualcomponent:draw(draw)
	self.producer(self.parent, draw)
end

return customvisualcomponent
