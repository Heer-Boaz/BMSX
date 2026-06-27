local linear<const> = function(value)
	if value < 0 then
		return 0
	end
	if value > 1 then
		return 1
	end
	return value
end

local ease_in_quad<const> = function(value)
	local x<const> = linear(value)
	return x * x
end

local ease_out_quad<const> = function(value)
	local x<const> = linear(1 - value)
	return 1 - (x * x)
end

local ease_in_out_quad<const> = function(value)
	local x<const> = linear(value)
	if x < 0.5 then
		return 2 * x * x
	end
	local y<const> = (-2 * x) + 2
	return 1 - ((y * y) / 2)
end

local ease_out_back<const> = function(value)
	local x<const> = linear(value)
	local t<const> = x - 1
	local c1<const> = 1.70158
	local c3<const> = c1 + 1
	return 1 + (c3 * t * t * t) + (c1 * t * t)
end

local smoothstep<const> = function(value)
	local x<const> = linear(value)
	return x * x * (3 - (2 * x))
end

local pingpong01<const> = function(value)
	local p<const> = value % 2
	if p < 1 then
		return p
	end
	return 2 - p
end

local arc01<const> = function(value)
	if value <= 0.5 then
		return smoothstep(value * 2)
	end
	return smoothstep((1 - value) * 2)
end

return {
	linear = linear,
	ease_in_quad = ease_in_quad,
	ease_out_quad = ease_out_quad,
	ease_in_out_quad = ease_in_out_quad,
	ease_out_back = ease_out_back,
	smoothstep = smoothstep,
	pingpong01 = pingpong01,
	arc01 = arc01,
}
