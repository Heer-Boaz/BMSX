local function div_toward_zero(value, divisor)
	if value >= 0 then
		return math.floor(value / divisor)
	end
	return -math.floor((-value) / divisor)
end

return div_toward_zero
