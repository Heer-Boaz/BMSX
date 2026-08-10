-- fsmlibrary.lua
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
--    fsmcomponent.factory() binds the selected machine ids into the prefab's
--    component constructor. The component resolves their current definitions
--    when the world constructs the object.

local fsmcomponent<const> = require('cartlib/fsm/fsmcomponent')
local fsm<const> = require('cartlib/fsm/fsm')
local registry<const> = require('cartlib/registry')

local fsmlibrary<const> = {}

-- fsmlibrary.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsmlibrary.register(machine_name, blueprint)
	local replacement<const> = fsm.state_definition.new(machine_name, blueprint)
	local previous<const> = fsmcomponent.definition(machine_name)
	if previous then
		fsm.assert_rebind_compatible(previous, replacement)
	end
	fsmcomponent.set_definition(machine_name, replacement)
	local components<const> = registry:entries(fsmcomponent)
	for i = 1, #components do
		local state_machines<const> = components[i]
		state_machines:rebind_state_machine(machine_name, replacement)
	end
end

return fsmlibrary
