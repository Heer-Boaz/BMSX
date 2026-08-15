local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local bt_program<const> = require('cartlib/behaviour_tree/program')
local registry<const> = require('cartlib/registry')

local behaviour_tree_library<const> = {}

function behaviour_tree_library.register(root)
	local program<const> = bt_program.compile(root)
	local tree_id<const> = program.id
	bt_component.install_program(program)
	local components<const> = registry:entries(bt_component)
	for i = 1, #components do
		local behaviour_tree<const> = components[i]
		if behaviour_tree.tree_id == tree_id then
			behaviour_tree:rebind_program(program)
		end
	end
end

return behaviour_tree_library
