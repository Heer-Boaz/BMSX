local base_component<const> = require('cartlib/component/base_component')

local bt_component<const> = {}
bt_component.__index = bt_component
setmetatable(bt_component, { __index = base_component })

local definitions_by_id<const> = {}

function bt_component.definition(tree_id)
	return definitions_by_id[tree_id]
end

function bt_component.set_definition(tree_id, root)
	definitions_by_id[tree_id] = root
end

function bt_component.new(opts, tree_id)
	local self<const> = setmetatable(base_component.new(opts), bt_component)
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
