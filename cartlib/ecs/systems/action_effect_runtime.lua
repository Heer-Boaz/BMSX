-- action_effect_runtime.lua
-- Action-effect cooldown ECS system.

local ecs<const> = require('cartlib/ecs/ecs')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local action_effect_runtime_component_type<const> = component_types.action_effect

local actioneffectruntimesystem<const> = {}
actioneffectruntimesystem.__index = actioneffectruntimesystem
actioneffectruntimesystem.component_types = { action_effect_runtime_component_type }
setmetatable(actioneffectruntimesystem, { __index = ecsystem })

function actioneffectruntimesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.actioneffect, priority or 32), actioneffectruntimesystem)
	return self
end

function actioneffectruntimesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[action_effect_runtime_component_type]
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + dt_ms
		for _, effect in pairs(component.effects) do
			if effect.cooldown_until > 0 and component.time_ms >= effect.cooldown_until then
				effect.cooldown_until = 0
			end
		end
	end
end

return actioneffectruntimesystem.new
