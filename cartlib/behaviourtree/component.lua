local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local behaviourtreecomponent<const> = {}
behaviourtreecomponent.__index = behaviourtreecomponent
setmetatable(behaviourtreecomponent, { __index = component })

function behaviourtreecomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.behaviour_tree), behaviourtreecomponent)
	self.root = opts.root
	self.nodedata = {}
	return self
end

return behaviourtreecomponent
