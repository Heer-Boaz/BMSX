local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local definitions_by_id<const> = require('cartlib/behaviourtree/definitions')
local registry<const> = require('cartlib/registry')

local behaviourtree_library<const> = {}

function behaviourtree_library.register(root)
	local tree_id<const> = root.id
	definitions_by_id[tree_id] = root
	local components<const> = registry:components(bt_component)
	for i = 1, #components do
		local behaviourtree<const> = components[i]
		if behaviourtree.tree_id == tree_id then
			behaviourtree:rebind_root(root)
		end
	end
end

return behaviourtree_library
