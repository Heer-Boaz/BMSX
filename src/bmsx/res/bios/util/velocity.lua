local function consume_axis_accum(accum, speed_num, speed_den)
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

local function set_velocity(target, speed_x_num, speed_y_num, speed_den)
	target.speed_x_num = speed_x_num
	target.speed_y_num = speed_y_num
	target.speed_den = speed_den
	target.speed_accum_x = 0
	target.speed_accum_y = 0
end

local function move_with_velocity(target)
	local dx, next_accum_x = consume_axis_accum(target.speed_accum_x, target.speed_x_num, target.speed_den)
	local dy, next_accum_y = consume_axis_accum(target.speed_accum_y, target.speed_y_num, target.speed_den)
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
