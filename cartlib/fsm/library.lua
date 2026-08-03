-- fsmlibrary.lua
-- Registry of FSM definitions for carts.
--
-- DESIGN PRINCIPLES — FSM definitions
--
-- 1. PUBLISH ONCE PER COMPILED REVISION, ATTACH MANY TIMES.
--    A 'machine_name' maps to a single compiled statedefinition.  Register the
--    blueprint from its module-level <init> participant. A replacement rebinds
--    retained runtime trees without resetting their live state. Prefabs attach
--    the runtime component only to objects that list the definition in `fsms`.
--
-- 2. THE @build_fsm DECORATOR IS THE PREFERRED PATTERN.
--    In TypeScript/annotated Lua, @build_fsm on a function auto-registers the
--    result. Prefer that over explicit registration in cart code.

local fsm<const> = require('cartlib/fsm/fsm')
local component_types<const> = require('cartlib/components/types')
local registry_instance<const> = require('cartlib/registry').instance

local statedefinitions<const> = {}

local fsmlibrary<const> = {}

-- fsmlibrary.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsmlibrary.register(machine_name, blueprint)
	local replacement<const> = fsm.statedefinition.new(machine_name, blueprint)
	local previous<const> = statedefinitions[machine_name]
	if previous then
		fsm.assert_rebind_compatible(previous, replacement)
	end
	statedefinitions[machine_name] = replacement
	local components<const> = registry_instance:get_registered_entities_by_type(component_types.state_machine)
	for _, state_machines in pairs(components) do
		state_machines:rebind_statemachine(machine_name, replacement)
	end
end

function fsmlibrary.get(machine_name)
	return statedefinitions[machine_name]
end

return fsmlibrary
