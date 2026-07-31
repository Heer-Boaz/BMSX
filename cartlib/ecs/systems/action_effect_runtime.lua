-- action_effect_runtime.lua
-- actioneffectruntime pipeline system.

local ecs<const> = require('cartlib/ecs/ecs')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local action_effect_runtime_component_type<const> = component_types.action_effect

local actioneffectruntimesystem<const> = {}
actioneffectruntimesystem.__index = actioneffectruntimesystem
setmetatable(actioneffectruntimesystem, { __index = ecsystem })

function actioneffectruntimesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.actioneffect, priority), actioneffectruntimesystem)
	return self
end

function actioneffectruntimesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[action_effect_runtime_component_type]
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + dt_ms
		for id, until_time in pairs(component.cooldown_until) do
			if component.time_ms >= until_time then
				component.cooldown_until[id] = nil
			end
		end
	end
end

return {
	id = 'actioneffectruntime',
	group = tickgroup.actioneffect,
	default_priority = 32,
	create = actioneffectruntimesystem.new,
}
