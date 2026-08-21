local velocity<const> = require('cartlib/velocity')
local ballistic_movement_component<const> = require('cartlib/physics/ballistic_movement_component')
local bouncing_movement_component<const> = require('cartlib/physics/bouncing_movement_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')
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
velocity_system.fixed_point_tick = {
	group = tick_group.input,
	priority = -5,
	clock_source = clock.gameplay,
	method = 'update_fixed_point',
}

local horizontal_contacts<const> = kinematic_movement_component.contact_left
	| kinematic_movement_component.contact_right
local vertical_contacts<const> = kinematic_movement_component.contact_up
	| kinematic_movement_component.contact_down
local move_kinematic<const> = kinematic_movement_component.move

function velocity_system.new(world)
	velocity.configure_gameplay_delta(clock.gameplay_delta_milliseconds())
	local self<const> = setmetatable(base_system.new(velocity_system.tick), velocity_system)
	self:add_tick_function(velocity_system.fixed_point_tick)
	self._bouncing_component_view = world:active_tick_view(
		bouncing_movement_component,
		clock.gameplay
	)
	self._rational_component_view = world:active_tick_view(velocity_component, clock.gameplay)
	self._fixed_point_component_view = world:active_tick_view(fixed_point_velocity_component, clock.gameplay)
	self._ballistic_component_view = world:active_tick_view(
		ballistic_movement_component,
		clock.gameplay
	)
	return self
end

function velocity_system:update()
	local bouncing_components<const> = self._bouncing_component_view.components
	for index = 1, #bouncing_components do
		local component<const> = bouncing_components[index]
		local parent<const> = component.parent
		local velocity_x<const> = parent.speed_x_num
		local velocity_y<const> = parent.speed_y_num
		local contacts<const> = move_kinematic(component, velocity_x, velocity_y)
		if (contacts & horizontal_contacts) ~= 0 then
			parent.speed_x_num = -velocity_x
		end
		if (contacts & vertical_contacts) ~= 0 then
			parent.speed_y_num = -velocity_y
		end
	end

	local components<const> = self._rational_component_view.components
	for index = 1, #components do
		velocity.move_with_velocity(components[index].parent)
	end
end

-- Fixed-point movers advance before their owner logic consumes the new
-- position, matching MovementComponent's tick-before-owner ordering. The
-- established rational projectile lane remains after behaviour evaluation;
-- adding Q8.8 motion must not silently reschedule that existing contract.
function velocity_system:update_fixed_point()
	local fixed_point_components<const> = self._fixed_point_component_view.components
	for index = 1, #fixed_point_components do
		local component<const> = fixed_point_components[index]
		local parent<const> = component.parent
		local x<const> = component.fraction_x + component.velocity_x
		local y<const> = component.fraction_y + component.velocity_y
		component.fraction_x = x & 0xff
		component.fraction_y = y & 0xff
		parent.x = parent.x + (x >> 8)
		parent.y = parent.y + (y >> 8)
	end

	local ballistic_components<const> = self._ballistic_component_view.components
	for index = 1, #ballistic_components do
		local component<const> = ballistic_components[index]
		component.velocity_x = component.velocity_x + component.acceleration_x
		component.velocity_y = component.velocity_y + component.acceleration_y
	end
end

return velocity_system
