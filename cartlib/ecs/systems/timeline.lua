-- timeline.lua
-- Timeline ECS system.

local ecs<const> = require('cartlib/ecs/ecs')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local timeline_component_type<const> = component_types.timeline

local timelinesystem<const> = {}
timelinesystem.__index = timelinesystem
timelinesystem.component_types = { timeline_component_type }
setmetatable(timelinesystem, { __index = ecsystem })

function timelinesystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.animation, priority), timelinesystem)
	return self
end

function timelinesystem:update(dt_ms)
	local components<const> = world_instance.active_space.active_components_by_type[timeline_component_type]
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component.active_count ~= 0 then
			component:tick_active(dt_ms)
		end
	end
end

return timelinesystem.new
