-- timeline_system.lua
-- Timeline ECS system.

local timeline_component<const> = require('cartlib/timeline/timeline_component')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')

local timeline_system<const> = {}
timeline_system.__index = timeline_system
setmetatable(timeline_system, { __index = basesystem })

function timeline_system.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.animation, 0), timeline_system)
	self._component_view = world:active_component_view(timeline_component)
	return self
end

function timeline_system:update(delta_time)
	local components<const> = self._component_view.components
	for i = 1, #components do
		local component<const> = components[i]
		if component._active_count ~= 0 then
			component:tick_active(delta_time)
		end
	end
end

return timeline_system
