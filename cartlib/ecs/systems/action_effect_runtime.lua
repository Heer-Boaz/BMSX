-- action_effect_runtime.lua
-- Action-effect cooldown ECS system.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system

local action_effect_runtime_component_type<const> = component_types.action_effect

local action_effect_runtime_system<const> = {}
action_effect_runtime_system.__index = action_effect_runtime_system
action_effect_runtime_system.component_types = { action_effect_runtime_component_type }
setmetatable(action_effect_runtime_system, { __index = system })

function action_effect_runtime_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.action_effects, priority or 32), action_effect_runtime_system)
	return self
end

function action_effect_runtime_system:update(dt_ms)
	local components<const> = world.active_space.active_components_by_type[action_effect_runtime_component_type]
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

return action_effect_runtime_system.new
