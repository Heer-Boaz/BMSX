-- actioneffect_system.lua
-- Action-effect cooldown ECS system.

local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local base_system<const> = require('cartlib/world/base_system')
local tick_group<const> = require('cartlib/world/tick_group')

local actioneffect_system<const> = {}
actioneffect_system.__index = actioneffect_system
setmetatable(actioneffect_system, { __index = base_system })

function actioneffect_system.new(world)
	local self<const> = setmetatable(base_system.new(tick_group.actioneffects, 0), actioneffect_system)
	self._component_view = world:active_component_view(actioneffect_component)
	return self
end

function actioneffect_system:update(delta_time)
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + delta_time
	end
end

return actioneffect_system
