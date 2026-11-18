local function work(seed, step)
	local object = { x = seed, y = 2.0 }
	local list = { 3, 5, 7 }
	local function captured(value)
		object.x = object.x + value
		return object.x
	end
	local sum = 0
	for i = 1, 17 do
		sum = sum + list[(i % 3) + 1]
	end
	return captured(step), object.y + 1, object.y / list[1], sum, list[1.0]
end
return work(7, 4)
