-- actioneffectsystem.lua
-- Action-effect cooldown ECS system.

local actioneffectcomponent<const> = require('cartlib/actioneffects/actioneffectcomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local actioneffectsystem<const> = {}
actioneffectsystem.__index = actioneffectsystem
setmetatable(actioneffectsystem, { __index = basesystem })

function actioneffectsystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.actioneffects, 0), actioneffectsystem)
	self._component_view = world:_active_component_view(actioneffectcomponent)
	return self
end

function actioneffectsystem:update(delta_time)
	local components<const> = self._component_view.items
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + delta_time
	end
end

return actioneffectsystem
