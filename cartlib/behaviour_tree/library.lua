local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local bt_program<const> = require('cartlib/behaviour_tree/program')
local world<const> = require('cartlib/world/world')

local behaviour_tree_library<const> = {}

function behaviour_tree_library.register(tree_id, definition)
	local program<const> = bt_program.compile(tree_id, definition)
	if not bt_component.install_program(program) then return end
	world:visit_admitted_components(bt_component, function(behaviour_tree)
		if behaviour_tree.tree_id == tree_id then
			behaviour_tree:rebind_program(program)
		end
	end)
end

return behaviour_tree_library
