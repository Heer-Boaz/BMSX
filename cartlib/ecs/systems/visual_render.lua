-- visual_render.lua
-- visualrender pipeline system.

local ecs<const> = require('cartlib/ecs/ecs')
local world_instance<const> = require('cartlib/world/world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local visualrendersystem<const> = {}
visualrendersystem.__index = visualrendersystem
setmetatable(visualrendersystem, { __index = ecsystem })

function visualrendersystem.new(priority)
	return setmetatable(ecsystem.new(tickgroup.presentation, priority), visualrendersystem)
end

function visualrendersystem:update()
	world_instance:sort_active_visuals()
	local components<const> = world_instance.active_space.active_visual_components
	for i = 1, #components do
		local component<const> = components[i]
		if component.parent.visible and component.visible then
			component:draw()
		end
	end
end

return {
	id = 'visualrender',
	group = tickgroup.presentation,
	create = visualrendersystem.new,
}
