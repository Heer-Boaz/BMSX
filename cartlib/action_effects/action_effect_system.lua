-- action_effect_system.lua
-- Action-effect cooldown ECS system.

local action_effects<const> = require('cartlib/action_effects')
local system_module<const> = require('cartlib/world/system')

local tick_group<const> = system_module.tick_group
local system<const> = system_module.system

local action_effect_runtime_component_type<const> = action_effects.action_effect_component.type_name

local action_effect_system<const> = {}
action_effect_system.__index = action_effect_system
setmetatable(action_effect_system, { __index = system })

function action_effect_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.action_effects, 0), action_effect_system)
	self.components = world:_active_component_view(action_effect_runtime_component_type)
	return self
end

function action_effect_system:update(dt_ms)
	local components<const> = self.components.items
	for i = 1, #components do
		local component<const> = components[i]
		component.time_ms = component.time_ms + dt_ms
	end
end

return action_effect_system
