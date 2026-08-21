local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')
local div_toward_zero<const> = require('cartlib/util/div_toward_zero')

-- Signed Q8.8 velocity with the fractional bytes of the X/Y position retained
-- on the component. The parent owns the visible integer position; the motion
-- system advances that position exactly like a two's-complement fixed-point
-- accumulator.
local fixed_point_velocity_component<const> = {}
fixed_point_velocity_component.__index = fixed_point_velocity_component
fixed_point_velocity_component.unique = true
fixed_point_velocity_component._tick_clocks = clock.gameplay
setmetatable(fixed_point_velocity_component, { __index = base_component })

local velocity_q8_scale<const> = function()
	return clock.update_milliseconds() * 0.001 * 0x100
end

function fixed_point_velocity_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), fixed_point_velocity_component)
	self.velocity_x = 0
	self.velocity_y = 0
	self.fraction_x = 0
	self.fraction_y = 0
	return self
end

-- Converts authored wall-clock velocity once at the fixed-point owner. Runtime
-- integration continues to consume only signed Q8.8 words at the cart's fixed
-- gameplay cadence.
function fixed_point_velocity_component:set_velocity_pixels_per_second(velocity_x, velocity_y)
	local scale<const> = velocity_q8_scale()
	self.velocity_x = math.round(velocity_x * scale)
	self.velocity_y = math.round(velocity_y * scale)
end

-- Retains a direction in signed Q8.8 while making its dominant axis equal to
-- the requested magnitude. Homing actors calculate this once when they acquire
-- a target; the velocity system then advances the retained integer datapath
-- without normalizing vectors or dividing in the frame loop.
function fixed_point_velocity_component:set_dominant_axis_velocity(delta_x, delta_y, magnitude_q8)
	local abs_x<const> = math.abs(delta_x)
	local abs_y<const> = math.abs(delta_y)
	if abs_x == 0 then
		self.velocity_x = 0
		self.velocity_y = delta_y > 0 and magnitude_q8 or -magnitude_q8
		return
	end
	if abs_y == 0 then
		self.velocity_x = delta_x > 0 and magnitude_q8 or -magnitude_q8
		self.velocity_y = 0
		return
	end
	if abs_x > abs_y then
		self.velocity_x = delta_x > 0 and magnitude_q8 or -magnitude_q8
		self.velocity_y = div_toward_zero(delta_y * magnitude_q8, abs_x)
		return
	end
	self.velocity_x = div_toward_zero(delta_x * magnitude_q8, abs_y)
	self.velocity_y = delta_y > 0 and magnitude_q8 or -magnitude_q8
end

function fixed_point_velocity_component:set_dominant_axis_speed_pixels_per_second(
	delta_x,
	delta_y,
	pixels_per_second
)
	self:set_dominant_axis_velocity(
		delta_x,
		delta_y,
		math.round(pixels_per_second * velocity_q8_scale())
	)
end

return fixed_point_velocity_component
