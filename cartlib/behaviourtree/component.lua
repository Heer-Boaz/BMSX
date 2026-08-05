local component<const> = require('cartlib/world/component')
local registry<const> = require('cartlib/registry')

local behaviourtreecomponent<const> = {}
behaviourtreecomponent.__index = behaviourtreecomponent
behaviourtreecomponent.type_name = 'behaviourtreecomponent'
setmetatable(behaviourtreecomponent, { __index = component })

function behaviourtreecomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, behaviourtreecomponent.type_name), behaviourtreecomponent)
	self.root = opts.root
	self.nodedata = {}
	return self
end

function behaviourtreecomponent.factory(root)
	local components<const> = registry:entities_by_type(behaviourtreecomponent.type_name)
	for i = 1, #components do
		local behaviour_tree<const> = components[i]
		if behaviour_tree.id_local == root.id then
			behaviour_tree.root = root
		end
	end
	return function(opts)
		local self<const> = behaviourtreecomponent.new(opts)
		self.root = root
		self.id_local = root.id
		return self
	end
end

return behaviourtreecomponent
