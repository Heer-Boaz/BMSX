local btcomponent<const> = require('cartlib/behaviourtree/btcomponent')
local registry<const> = require('cartlib/registry')

local behaviourtreelibrary<const> = {}

function behaviourtreelibrary.register(root)
	local tree_id<const> = root.id
	btcomponent.set_definition(tree_id, root)
	local components<const> = registry:entries(btcomponent)
	for i = 1, #components do
		local behaviourtree<const> = components[i]
		if behaviourtree.tree_id == tree_id then
			behaviourtree:rebind_root(root)
		end
	end
end

return behaviourtreelibrary
