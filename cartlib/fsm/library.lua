-- fsm_library.lua
-- Registry of FSM definitions for carts.
--
-- DESIGN PRINCIPLES — FSM definitions
--
-- 1. PUBLISH ONCE PER EXPLICIT CART INITIALIZATION, ATTACH MANY TIMES.
--    A 'machine_name' maps to a single compiled state_definition. The cart's
--    explicit init function registers each blueprint. A replacement rebinds
--    retained runtime trees without resetting their live state. Prefabs attach
--    the runtime component only to objects that list the definition in `fsms`.
--
-- 2. THE @build_fsm DECORATOR IS THE PREFERRED PATTERN.
--    In TypeScript/annotated Lua, @build_fsm on a function auto-registers the
--    result. Prefer that over explicit registration in cart code.

local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local state_definitions<const> = require('cartlib/fsm/definitions')
local fsm<const> = require('cartlib/fsm/fsm')
local registry<const> = require('cartlib/registry')

local fsm_library<const> = {}

-- fsm_library.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsm_library.register(machine_name, blueprint)
	local replacement<const> = fsm.state_definition.new(machine_name, blueprint)
	local previous<const> = state_definitions[machine_name]
	if previous then
		fsm.assert_rebind_compatible(previous, replacement)
	end
	state_definitions[machine_name] = replacement
	local components<const> = registry:components(fsm_component)
	for i = 1, #components do
		local state_machines<const> = components[i]
		state_machines:rebind_state_machine(machine_name, replacement)
	end
end

function fsm_library.get(machine_name)
	return state_definitions[machine_name]
end

return fsm_library
