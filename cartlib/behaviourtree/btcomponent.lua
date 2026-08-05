local component<const> = require('cartlib/component/basecomponent')
local registry<const> = require('cartlib/registry')

local bt_component<const> = {}
bt_component.__index = bt_component
setmetatable(bt_component, { __index = component })

function bt_component.new(opts)
	local self<const> = setmetatable(component.new(opts), bt_component)
	self.root = opts.root
	self.node_data = {}
	return self
end

function bt_component.factory(root)
	local components<const> = registry:components(bt_component)
	for i = 1, #components do
		local behaviourtree<const> = components[i]
		if behaviourtree.id_local == root.id then
			behaviourtree.root = root
		end
	end
	return function(opts)
		local self<const> = bt_component.new(opts)
		self.root = root
		self.id_local = root.id
		return self
	end
end

return bt_component
