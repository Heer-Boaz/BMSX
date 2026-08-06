-- fsmlibrary.lua
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
	local components<const> = registry:components(fsmcomponent)
	for i = 1, #components do
		local state_machines<const> = components[i]
		state_machines:rebind_state_machine(machine_name, replacement)
	end
end

return fsmlibrary
