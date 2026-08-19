local velocity<const> = require('cartlib/velocity')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local velocity_system<const> = {}
velocity_system.__index = velocity_system
setmetatable(velocity_system, { __index = base_system })
velocity_system.tick = {
	group = tick_group.input,
	priority = 5,
	clock_source = clock.gameplay,
	method = 'update',
}

function velocity_system.new(world)
	local self<const> = setmetatable(base_system.new(velocity_system.tick), velocity_system)
	self._component_view = world:active_tick_view(velocity_component, clock.gameplay)
	return self
end

function velocity_system:update()
	local components<const> = self._component_view.components
	for index = 1, #components do
		velocity.move_with_velocity(components[index].parent)
	end
end

return velocity_system
