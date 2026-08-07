-- fsmsystem.lua
-- Finite-state-machine ECS system.

local fsmcomponent<const> = require('cartlib/fsm/fsmcomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local fsmsystem<const> = {}
fsmsystem.__index = fsmsystem
setmetatable(fsmsystem, { __index = basesystem })

function fsmsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.gameplay, 0), fsmsystem)
	self._component_view = world:active_component_view(fsmcomponent)
	return self
end

function fsmsystem:update(delta_time)
	local components<const> = self._component_view.components
	for i = 1, #components do
		components[i]:update(delta_time)
	end
end

return fsmsystem
