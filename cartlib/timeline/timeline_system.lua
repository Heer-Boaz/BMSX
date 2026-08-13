-- timeline_system.lua
-- Timeline ECS system.

local timeline_component<const> = require('cartlib/timeline/timeline_component')
local base_system<const> = require('cartlib/world/base_system')
local tick_group<const> = require('cartlib/world/tick_group')

local timeline_system<const> = {}
timeline_system.__index = timeline_system
setmetatable(timeline_system, { __index = base_system })

function timeline_system.new(world)
	local self<const> = setmetatable(base_system.new(tick_group.animation, 0), timeline_system)
	self._component_view = world:active_component_view(timeline_component)
	return self
end

function timeline_system:update(delta_time)
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		if component._tick_count ~= 0 then
			component:tick_active(delta_time)
		end
	end
end

return timeline_system
