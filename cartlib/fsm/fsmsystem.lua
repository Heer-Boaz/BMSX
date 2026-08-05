-- fsmsystem.lua
-- Finite-state-machine ECS system.

local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')

local fsmsystem<const> = {}
fsmsystem.__index = fsmsystem
setmetatable(fsmsystem, { __index = system })

function fsmsystem.new(world)
	local self<const> = setmetatable(system.new(tick_group.gameplay, 0), fsmsystem)
	self._component_view = world:_active_component_view(fsm_component)
	return self
end

function fsmsystem:update(delta_time)
	local components<const> = self._component_view.items
	for i = 1, #components do
		components[i]:update(delta_time)
	end
end

return fsmsystem
