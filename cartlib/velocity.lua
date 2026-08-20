-- Shared integer-remainder movement for cart entities.
local div_toward_zero<const> = require('cartlib/util/div_toward_zero')

local consume_axis_accum<const> = function(accum, speed_num, speed_den)
	accum = accum + speed_num
	if accum > -speed_den and accum < speed_den then
		return 0, accum
	end
	local delta<const> = div_toward_zero(accum, speed_den)
	return delta, accum - delta * speed_den
end

-- Retains the non-negative fractional word of a fixed-point position. Unlike
-- consume_axis_accum, signed motion crosses the integer boundary toward
-- negative infinity, matching addition to a two's-complement fixed-point word.
local consume_axis_fraction<const> = function(fraction, speed_num, speed_den)
	local value<const> = fraction + speed_num
	local delta<const> = value // speed_den
	return delta, value - delta * speed_den
end

-- Scales a direction so its dominant axis has the requested magnitude. This
-- is the retained movement representation used by sprite-era homing actors:
-- no square root, normalized vector allocation or per-frame re-targeting.
local dominant_axis_velocity<const> = function(delta_x, delta_y, magnitude)
	local abs_x<const> = math.abs(delta_x)
	local abs_y<const> = math.abs(delta_y)
	if abs_x == 0 then
		return 0, delta_y > 0 and magnitude or -magnitude
	end
	if abs_y == 0 then
		return delta_x > 0 and magnitude or -magnitude, 0
	end
	if abs_x > abs_y then
		return delta_x > 0 and magnitude or -magnitude,
			(delta_y * magnitude) / abs_x
	end
	return (delta_x * magnitude) / abs_y,
		delta_y > 0 and magnitude or -magnitude
end

local move_with_velocity<const> = function(target)
	local speed_den<const> = target.speed_den
	if speed_den == 1 then
		target.x = target.x + target.speed_accum_x + target.speed_x_num
		target.y = target.y + target.speed_accum_y + target.speed_y_num
		target.speed_accum_x = 0
		target.speed_accum_y = 0
		return
	end
	local dx<const>, next_accum_x<const> = consume_axis_accum(target.speed_accum_x, target.speed_x_num, speed_den)
	local dy<const>, next_accum_y<const> = consume_axis_accum(target.speed_accum_y, target.speed_y_num, speed_den)
	target.speed_accum_x = next_accum_x
	target.speed_accum_y = next_accum_y
	target.x = target.x + dx
	target.y = target.y + dy
end

return {
	consume_axis_accum = consume_axis_accum,
	consume_axis_fraction = consume_axis_fraction,
	dominant_axis_velocity = dominant_axis_velocity,
	move_with_velocity = move_with_velocity,
}
