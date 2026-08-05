-- actioneffectsystem.lua
-- Action-effect cooldown ECS system.

local actioneffects<const> = require('cartlib/actioneffects')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')

local actioneffectsystem<const> = {}
actioneffectsystem.__index = actioneffectsystem
setmetatable(actioneffectsystem, { __index = system })

function actioneffectsystem.new(world)
	local self<const> = setmetatable(system.new(tick_group.actioneffects, 0), actioneffectsystem)
	self._component_view = world:_active_component_view(actioneffects.actioneffect_component)
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
