local component<const> = require('cartlib/world/component')
local registry<const> = require('cartlib/registry')

local behaviour_tree_component<const> = {}
behaviour_tree_component.__index = behaviour_tree_component
behaviour_tree_component.type_name = 'behaviour_tree_component'
setmetatable(behaviour_tree_component, { __index = component })

function behaviour_tree_component.new(opts)
	local self<const> = setmetatable(component.new(opts, behaviour_tree_component.type_name), behaviour_tree_component)
	self.root = opts.root
	self.node_data = {}
	return self
end

function behaviour_tree_component.factory(root)
	local components<const> = registry:entities_by_type(behaviour_tree_component.type_name)
	for i = 1, #components do
		local behaviour_tree<const> = components[i]
		if behaviour_tree.id_local == root.id then
			behaviour_tree.root = root
		end
	end
	return function(opts)
		local self<const> = behaviour_tree_component.new(opts)
		self.root = root
		self.id_local = root.id
		return self
	end
end

return behaviour_tree_component
