local basecomponent<const> = require('cartlib/component/basecomponent')
local definitions_by_id<const> = require('cartlib/behaviourtree/definitions')

local btcomponent<const> = {}
btcomponent.__index = btcomponent
setmetatable(btcomponent, { __index = basecomponent })

function btcomponent.new(opts, tree_id)
	local self<const> = setmetatable(basecomponent.new(opts), btcomponent)
	self.tree_id = tree_id
	self.root = definitions_by_id[tree_id]
	self.node_data = {}
	return self
end

function btcomponent.factory(tree_id)
	return function(opts)
		return btcomponent.new(opts, tree_id)
	end
end

function btcomponent:rebind_root(root)
	self.root = root
end

return btcomponent
