-- state_machine_system.lua
-- Finite-state-machine ECS system.

local state_machine_component<const> = require('cartlib/fsm/component')
local system<const> = require('cartlib/world/system')
local tick_group<const> = require('cartlib/world/tick_group')

local state_machine_component_type<const> = state_machine_component.type_name

local state_machine_system<const> = {}
state_machine_system.__index = state_machine_system
setmetatable(state_machine_system, { __index = system })

function state_machine_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.gameplay, 0), state_machine_system)
	self.components = world:_active_component_view(state_machine_component_type)
	return self
end

function state_machine_system:update(dt_ms)
	local components<const> = self.components.items
	for i = 1, #components do
		components[i]:update(dt_ms)
	end
end

return state_machine_system
