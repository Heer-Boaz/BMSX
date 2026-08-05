-- timeline_system.lua
-- Timeline ECS system.

local timeline_component<const> = require('cartlib/timeline/component')
local system<const> = require('cartlib/world/system')
local tick_group<const> = require('cartlib/world/tick_group')


local timeline_component_type<const> = timeline_component.type_name

local timeline_system<const> = {}
timeline_system.__index = timeline_system
setmetatable(timeline_system, { __index = system })

function timeline_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.animation, 0), timeline_system)
	self._component_view = world:_active_component_view(timeline_component_type)
	return self
end

function timeline_system:update(dt_ms)
	local components<const> = self._component_view.items
	for i = #components, 1, -1 do
		local component<const> = components[i]
		if component._active_count ~= 0 then
			component:tick_active(dt_ms)
		end
	end
end

return timeline_system
