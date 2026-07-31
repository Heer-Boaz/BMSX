-- fsmlibrary.lua
-- Registry of FSM definitions for carts.
--
-- DESIGN PRINCIPLES — FSM definitions
--
-- 1. REGISTER ONCE, ATTACH MANY TIMES.
--    A 'machine_name' maps to a single compiled statedefinition.  Register the
--    blueprint once at module load time with fsmlibrary.register(). Prefabs
--    attach the retained runtime component only to
--    objects that list the definition in `fsms`.
--
-- 2. THE @build_fsm DECORATOR IS THE PREFERRED PATTERN.
--    In TypeScript/annotated Lua, @build_fsm on a function auto-registers the
--    result. Prefer that over explicit registration in cart code.

local fsm<const> = require('cartlib/fsm/fsm')

local statedefinitions<const> = {}

local fsmlibrary<const> = {}

-- fsmlibrary.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsmlibrary.register(machine_name, blueprint)
	statedefinitions[machine_name] = fsm.statedefinition.new(machine_name, blueprint)
end

function fsmlibrary.get(machine_name)
	return statedefinitions[machine_name]
end

return fsmlibrary
