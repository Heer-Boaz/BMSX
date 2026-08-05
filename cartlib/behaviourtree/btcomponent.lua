local component<const> = require('cartlib/component/basecomponent')
local definitions_by_id<const> = require('cartlib/behaviourtree/definitions')

local bt_component<const> = {}
bt_component.__index = bt_component
setmetatable(bt_component, { __index = component })

function bt_component.new(opts, tree_id)
	local self<const> = setmetatable(component.new(opts), bt_component)
	self.tree_id = tree_id
	self.root = definitions_by_id[tree_id]
	self.node_data = {}
	return self
end

function bt_component.factory(tree_id)
	return function(opts)
		return bt_component.new(opts, tree_id)
	end
end

function bt_component:rebind_root(root)
	self.root = root
end

return bt_component
