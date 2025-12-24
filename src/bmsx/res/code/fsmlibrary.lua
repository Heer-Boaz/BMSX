-- fsmlibrary.lua
-- Registry of FSM definitions for system ROM

local fsm = require("fsm")

local StateDefinitions = {}
local ActiveMachines = {}

local FSMLibrary = {}

function FSMLibrary.register(machine_name, blueprint)
	StateDefinitions[machine_name] = fsm.StateDefinition.new(machine_name, blueprint)
end

function FSMLibrary.clear(machine_name)
	StateDefinitions[machine_name] = nil
	ActiveMachines[machine_name] = nil
end

function FSMLibrary.build(machine_name, blueprint)
	FSMLibrary.register(machine_name, blueprint)
	return StateDefinitions[machine_name]
end

function FSMLibrary.get(machine_name)
	return StateDefinitions[machine_name]
end

function FSMLibrary.instantiate(machine_name, target)
	local definition = StateDefinitions[machine_name]
	assert(definition, "FSM '" .. machine_name .. "' not registered")
	local controller = fsm.StateMachineController.new({ target = target, definition = definition, fsm_id = machine_name })
	local list = ActiveMachines[machine_name]
	if not list then
		list = {}
		ActiveMachines[machine_name] = list
	end
	list[#list + 1] = controller.statemachines[machine_name]
	return controller
end

function FSMLibrary.active(machine_name)
	return ActiveMachines[machine_name] or {}
end

function FSMLibrary.definitions()
	return StateDefinitions
end

return FSMLibrary
