-- Shared integer-remainder movement for cart entities.
local div_toward_zero<const> = require('cartlib/util/div_toward_zero')

local pixels_per_second_scale
local velocity_q8_scale
local acceleration_q8_scale

-- The movement system fixes these conversion factors once, after the world
-- has selected its gameplay cadence. Carts author wall-clock rates; movement
-- components retain per-gameplay-tick words and never multiply by delta time
-- in their scheduled loops.
local configure_gameplay_delta<const> = function(delta_milliseconds)
	local delta_seconds<const> = delta_milliseconds * 0.001
	pixels_per_second_scale = delta_seconds
	velocity_q8_scale = delta_seconds * 0x100
	acceleration_q8_scale = delta_seconds * delta_seconds * 0x100
end

local pixels_per_second_to_pixels_per_tick<const> = function(value)
	return value * pixels_per_second_scale
end

local pixels_per_second_to_velocity_q8<const> = function(value)
	return math.round(value * velocity_q8_scale)
end

local pixels_per_second_squared_to_acceleration_q8<const> = function(value)
	return math.round(value * acceleration_q8_scale)
end

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
	configure_gameplay_delta = configure_gameplay_delta,
	pixels_per_second_to_pixels_per_tick = pixels_per_second_to_pixels_per_tick,
	pixels_per_second_to_velocity_q8 = pixels_per_second_to_velocity_q8,
	pixels_per_second_squared_to_acceleration_q8 = pixels_per_second_squared_to_acceleration_q8,
	consume_axis_accum = consume_axis_accum,
	consume_axis_fraction = consume_axis_fraction,
	move_with_velocity = move_with_velocity,
}
