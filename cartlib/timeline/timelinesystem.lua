-- timelinesystem.lua
-- Timeline ECS system.

local timelinecomponent<const> = require('cartlib/timeline/timelinecomponent')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local timelinesystem<const> = {}
timelinesystem.__index = timelinesystem
setmetatable(timelinesystem, { __index = basesystem })

function timelinesystem.new(world)
	local self<const> = setmetatable(basesystem.new(tickgroup.animation, 0), timelinesystem)
	self._component_view = world:active_component_view(timelinecomponent)
	return self
end

function timelinesystem:update(delta_time)
	local components<const> = self._component_view.components
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component._active_count ~= 0 then
			component:tick_active(delta_time)
		end
	end
end

return timelinesystem
