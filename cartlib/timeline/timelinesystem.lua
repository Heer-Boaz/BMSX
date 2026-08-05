-- timelinesystem.lua
-- Timeline ECS system.

local timelinecomponent<const> = require('cartlib/timeline/timelinecomponent')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')


local timelinesystem<const> = {}
timelinesystem.__index = timelinesystem
setmetatable(timelinesystem, { __index = system })

function timelinesystem.new(world)
	local self<const> = setmetatable(system.new(tick_group.animation, 0), timelinesystem)
	self._component_view = world:_active_component_view(timelinecomponent)
	return self
end

function timelinesystem:update(delta_time)
	local components<const> = self._component_view.items
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component._active_count ~= 0 then
			component:tick_active(delta_time)
		end
	end
end

return timelinesystem
