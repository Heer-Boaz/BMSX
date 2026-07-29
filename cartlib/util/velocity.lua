local consume_axis_accum<const> = function(accum, speed_num, speed_den)
	accum = accum + speed_num
	local delta = 0
	while accum >= speed_den do
		delta = delta + 1
		accum = accum - speed_den
	end
	while accum <= -speed_den do
		delta = delta - 1
		accum = accum + speed_den
	end
	return delta, accum
end

local set_velocity<const> = function(target, speed_x_num, speed_y_num, speed_den)
	target.speed_x_num = speed_x_num
	target.speed_y_num = speed_y_num
	target.speed_den = speed_den
	target.speed_accum_x = 0
	target.speed_accum_y = 0
end

local move_with_velocity<const> = function(target)
	local dx<const>, next_accum_x<const> = consume_axis_accum(target.speed_accum_x, target.speed_x_num, target.speed_den)
	local dy<const>, next_accum_y<const> = consume_axis_accum(target.speed_accum_y, target.speed_y_num, target.speed_den)
	target.speed_accum_x = next_accum_x
	target.speed_accum_y = next_accum_y
	target.x = target.x + dx
	target.y = target.y + dy
end

return {
	consume_axis_accum = consume_axis_accum,
	set_velocity = set_velocity,
	move_with_velocity = move_with_velocity,
}
