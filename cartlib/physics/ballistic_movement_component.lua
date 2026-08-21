local clock<const> = require('cartlib/clock')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')

-- Fixed-point velocity plus constant acceleration. It is a distinct scheduled
-- class so constant-velocity actors do not pay acceleration work in their
-- movement loop.
local ballistic_movement_component<const> = {}
ballistic_movement_component.__index = ballistic_movement_component
ballistic_movement_component._tick_clocks = clock.gameplay
setmetatable(ballistic_movement_component, { __index = fixed_point_velocity_component })

function ballistic_movement_component.new(opts)
	local self<const> = setmetatable(
		fixed_point_velocity_component.new(opts),
		ballistic_movement_component
	)
	self.acceleration_x = 0
	self.acceleration_y = 0
	return self
end

-- Converts authored acceleration once. Velocity and acceleration then remain
-- signed Q8.8 displacement words for the cart's fixed gameplay cadence.
function ballistic_movement_component:set_acceleration_pixels_per_second_squared(
	acceleration_x,
	acceleration_y
)
	local update_seconds<const> = clock.update_milliseconds() * 0.001
	local scale<const> = update_seconds * update_seconds * 0x100
	self.acceleration_x = math.round(acceleration_x * scale)
	self.acceleration_y = math.round(acceleration_y * scale)
end

return ballistic_movement_component
