-- fsm.lua
-- Finite-state-machine ECS system.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system
local state_machine_component_type<const> = component_types.state_machine

local fsm_system<const> = {}
fsm_system.__index = fsm_system
fsm_system.component_types = { state_machine_component_type }
setmetatable(fsm_system, { __index = system })

function fsm_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.gameplay, priority), fsm_system)
	return self
end

function fsm_system:update(dt_ms)
	local components<const> = world.active_space.active_components_by_type[state_machine_component_type]
	for i = 1, #components do
		components[i]:update(dt_ms)
	end
end

return fsm_system.new
