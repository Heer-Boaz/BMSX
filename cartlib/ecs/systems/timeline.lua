-- timeline.lua
-- Timeline ECS system.

local ecs<const> = require('cartlib/ecs')
local component_types<const> = require('cartlib/components/types')
local world<const> = require('cartlib/world/world')

local tick_group<const> = ecs.tick_group
local system<const> = ecs.system

local timeline_component_type<const> = component_types.timeline

local timeline_system<const> = {}
timeline_system.__index = timeline_system
timeline_system.component_types = { timeline_component_type }
setmetatable(timeline_system, { __index = system })

function timeline_system.new(priority)
	local self<const> = setmetatable(system.new(tick_group.animation, priority), timeline_system)
	return self
end

function timeline_system:update(dt_ms)
	local components<const> = world.active_space.active_components_by_type[timeline_component_type]
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component.active_count ~= 0 then
			component:tick_active(dt_ms)
		end
	end
end

return timeline_system.new
