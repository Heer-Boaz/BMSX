-- fsmlibrary.lua
-- registry of fsm definitions for system rom
--
-- DESIGN PRINCIPLES — FSM registration and instantiation
--
-- 1. REGISTER ONCE, INSTANTIATE MANY TIMES.
--    A 'machine_name' maps to a single compiled statedefinition.  Register the
--    blueprint once at module load time with fsmlibrary.register() or
--    fsmlibrary.build(), then call fsmlibrary.instantiate(name, target) for
--    each object that needs its own running FSM instance.
--
-- 2. instantiate() vs fsm.statemachinecontroller.new() DIRECTLY.
--    fsmlibrary.instantiate() looks up the registered definition and calls
--    statemachinecontroller.new() for you.  Only bypass the library when you
--    need a one-off FSM that is not shared across object types.
--
-- 3. THE @build_fsm DECORATOR IS THE PREFERRED PATTERN.
--    In TypeScript/annotated Lua, @build_fsm on a function auto-registers the
--    result and @assign_fsm on a class calls instantiate() at new() time.
--    Prefer those over explicit register/instantiate calls in cart code.
--
-- 4. fsmlibrary.active(machine_name) IS FOR DEBUGGING ONLY.
--    It returns all live state machine instances for a given type.  Do not
--    iterate it in gameplay code; reach objects through the world instead.

local fsm<const> = require('fsm')

local statedefinitions<const> = {}
local activemachines<const> = {}

local fsmlibrary<const> = {}

-- fsmlibrary.register(machine_name, blueprint)
--   Compiles a state-definition from blueprint and stores it under machine_name.
--   Replaces any previously registered definition with the same name.
function fsmlibrary.register(machine_name, blueprint)
	statedefinitions[machine_name] = fsm.statedefinition.new(machine_name, blueprint)
end

function fsmlibrary.clear(machine_name)
	statedefinitions[machine_name] = nil
	activemachines[machine_name] = nil
end

-- fsmlibrary.build(machine_name, blueprint): registers and returns the definition.
--   Convenience alias for fsmlibrary.register() when you need the returned
--   statedefinition immediately (e.g. for inline inspection or testing).
function fsmlibrary.build(machine_name, blueprint)
	fsmlibrary.register(machine_name, blueprint)
	return statedefinitions[machine_name]
end

function fsmlibrary.get(machine_name)
	return statedefinitions[machine_name]
end

-- fsmlibrary.instantiate(machine_name, target)
--   Creates a new statemachinecontroller for target using the registered
--   definition.  Errors if machine_name is not registered.
--   target is typically a worldobject; the controller stores itself on target.
--   Prefer the @assign_fsm decorator over calling this directly.
function fsmlibrary.instantiate(machine_name, target)
	local definition<const> = statedefinitions[machine_name]
	assert(definition, 'fsm "' .. machine_name .. '" not registered')
	local controller<const> = fsm.statemachinecontroller.new({ target = target, definition = definition, fsm_id = machine_name })
	local list = activemachines[machine_name]
	if not list then
		list = {}
		activemachines[machine_name] = list
	end
	list[#list + 1] = controller.statemachines[machine_name]
	return controller
end

function fsmlibrary.active(machine_name)
	return activemachines[machine_name] or {}
end

function fsmlibrary.definitions()
	return statedefinitions
end

return fsmlibrary
