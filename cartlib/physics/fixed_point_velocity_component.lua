local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')

-- Signed Q8.8 velocity with the fractional bytes of the X/Y position retained
-- on the component. The parent owns the visible integer position; the motion
-- system advances that position exactly like a two's-complement fixed-point
-- accumulator.
local fixed_point_velocity_component<const> = {}
fixed_point_velocity_component.__index = fixed_point_velocity_component
fixed_point_velocity_component.unique = true
fixed_point_velocity_component._tick_clocks = clock.gameplay
setmetatable(fixed_point_velocity_component, { __index = base_component })

function fixed_point_velocity_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), fixed_point_velocity_component)
	self.velocity_x = 0
	self.velocity_y = 0
	self.fraction_x = 0
	self.fraction_y = 0
	return self
end

return fixed_point_velocity_component
