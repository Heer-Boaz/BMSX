-- object_fsm.lua
-- objectfsm pipeline system.

local ecs<const> = require('cartlib/ecs/index')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem
local state_machine_component_type<const> = component_types.state_machine

local statemachinesystem<const> = {}
statemachinesystem.__index = statemachinesystem
setmetatable(statemachinesystem, { __index = ecsystem })

function statemachinesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.moderesolution, priority), statemachinesystem)
	return self
end

function statemachinesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[state_machine_component_type]
	for i = 1, #components do
		components[i]:update(dt_ms)
	end
end

return {
	id = 'objectfsm',
	group = tickgroup.moderesolution,
	create = statemachinesystem.new,
}
