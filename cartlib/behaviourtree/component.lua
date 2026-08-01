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

function behaviourtreecomponent.factory(root)
	return function(opts)
		local self<const> = behaviourtreecomponent.new(opts)
		self.root = root
		self.id_local = root.id
		return self
	end
end

return behaviourtreecomponent
