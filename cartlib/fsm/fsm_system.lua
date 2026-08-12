-- fsm_system.lua
-- Finite-state-machine ECS system.

local fsm_component<const> = require('cartlib/fsm/fsm_component')
local base_system<const> = require('cartlib/world/base_system')
local tick_group<const> = require('cartlib/world/tick_group')

local fsm_system<const> = {}
fsm_system.__index = fsm_system
setmetatable(fsm_system, { __index = base_system })

function fsm_system.new(world)
	local self<const> = setmetatable(base_system.new(tick_group.gameplay, 0), fsm_system)
	self._component_view = world:active_component_view(fsm_component)
	return self
end

function fsm_system:update(delta_time)
	local components<const> = self._component_view.components
	for i = 1, #components do
		components[i]:update(delta_time)
	end
end

return fsm_system
