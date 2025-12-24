-- fsmlibrary.lua
-- registry of fsm definitions for system rom

local fsm = require("fsm")

local statedefinitions = {}
local activemachines = {}

local fsmlibrary = {}

function fsmlibrary.register(machine_name, blueprint)
	statedefinitions[machine_name] = fsm.statedefinition.new(machine_name, blueprint)
end

function fsmlibrary.clear(machine_name)
	statedefinitions[machine_name] = nil
	activemachines[machine_name] = nil
end

function fsmlibrary.build(machine_name, blueprint)
	fsmlibrary.register(machine_name, blueprint)
	return statedefinitions[machine_name]
end

function fsmlibrary.get(machine_name)
	return statedefinitions[machine_name]
end

function fsmlibrary.instantiate(machine_name, target)
	local definition = statedefinitions[machine_name]
	assert(definition, "fsm '" .. machine_name .. "' not registered")
	local controller = fsm.statemachinecontroller.new({ target = target, definition = definition, fsm_id = machine_name })
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
