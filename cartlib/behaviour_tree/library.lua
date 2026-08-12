local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local registry<const> = require('cartlib/registry')

local behaviour_tree_library<const> = {}

function behaviour_tree_library.register(root)
	local tree_id<const> = root.id
	bt_component.set_definition(tree_id, root)
	local components<const> = registry:entries(bt_component)
	for i = 1, #components do
		local behaviour_tree<const> = components[i]
		if behaviour_tree.tree_id == tree_id then
			behaviour_tree:rebind_root(root)
		end
	end
end

return behaviour_tree_library
