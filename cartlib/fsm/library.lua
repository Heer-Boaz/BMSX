-- fsm_library.lua
-- Registry of FSM definitions for carts.
--
-- DESIGN PRINCIPLES — FSM definitions
--
-- 1. PUBLISH ONCE PER EXPLICIT CART INITIALIZATION, ATTACH MANY TIMES.
--    A 'machine_name' maps to a single compiled state_definition. The cart's
--    explicitly called entry initialization registers each blueprint; its
--    <init> marker exposes that same closure to Hot Resume tooling. A
--    replacement rebinds retained runtime trees without resetting live state.
--
-- 2. PREFABS ATTACH THE CONCRETE COMPONENT.
--    fsm_component.factory() binds the selected machine ids into the prefab's
--    component constructor. The component resolves their current definitions
--    when the world constructs the object.

local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm<const> = require('cartlib/fsm/fsm')
local registry<const> = require('cartlib/registry')

local fsm_library<const> = {}

-- fsm_library.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsm_library.register(machine_name, blueprint)
	local replacement<const> = fsm.state_definition.new(machine_name, blueprint)
	local previous<const> = fsm_component.definition(machine_name)
	if previous then
		fsm.assert_rebind_compatible(previous, replacement)
	end
	fsm_component.set_definition(machine_name, replacement)
	local components<const> = registry:entries(fsm_component)
	for i = 1, #components do
		local state_machines<const> = components[i]
		state_machines:rebind_state_machine(machine_name, replacement)
	end
end

return fsm_library
