local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')
local affine2<const> = require('cartlib/math/affine2')
local div_toward_zero<const> = require('cartlib/util/div_toward_zero')
local velocity<const> = require('cartlib/velocity')

-- Signed Q8.8 displacement and fractional integration state belong to this
-- component. Transform2D is the only pose authority; scheduled motion publishes
-- one achieved world-origin vector after the word integration succeeds.
local fixed_point_velocity_component<const> = {}
fixed_point_velocity_component.__index = fixed_point_velocity_component
fixed_point_velocity_component.unique = true
fixed_point_velocity_component._tick_clocks = clock.gameplay
setmetatable(fixed_point_velocity_component, { __index = base_component })

function fixed_point_velocity_component.new(owner, configuration, id_local)
	local self<const>, input<const> = base_component.new(owner, configuration)
	setmetatable(self, fixed_point_velocity_component)
	if id_local == nil then id_local = input.id_local end
	if id_local == nil then id_local = 'fixed_velocity' end
	self.id_local = id_local
	self.velocity_x = 0
	self.velocity_y = 0
	self.fraction_x = 0
	self.fraction_y = 0
	if input.velocity_x ~= nil then self.velocity_x = input.velocity_x end
	if input.velocity_y ~= nil then self.velocity_y = input.velocity_y end
	if input.fraction_x ~= nil then self.fraction_x = input.fraction_x end
	if input.fraction_y ~= nil then self.fraction_y = input.fraction_y end
	self.motion_committed = true
	return self
end

function fixed_point_velocity_component.factory(configuration)
	return function(owner)
		return fixed_point_velocity_component.new(owner, configuration)
	end
end

function fixed_point_velocity_component:on_attach()
	local spatial<const> = self.owner.spatial
	if spatial == nil or spatial._family ~= affine2 then
		error('fixed-point velocity component requires Transform2D')
	end
	self.spatial = spatial
	self._write_world_origin = spatial.set_world_origin
end

function fixed_point_velocity_component:on_detach()
	self.spatial = nil
	self._write_world_origin = nil
end

-- Converts authored wall-clock velocity once at the fixed-point owner. Runtime
-- integration continues to consume only signed Q8.8 words at the cart's fixed
-- gameplay cadence.
function fixed_point_velocity_component:set_velocity_pixels_per_second(velocity_x, velocity_y)
	self.velocity_x = velocity.pixels_per_second_to_velocity_q8(velocity_x)
	self.velocity_y = velocity.pixels_per_second_to_velocity_q8(velocity_y)
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
		velocity.pixels_per_second_to_velocity_q8(pixels_per_second)
	)
end

return fixed_point_velocity_component
