return function(value, divisor)
	if value >= 0 then
		return value // divisor
	end
	return -((-value) // divisor)
end
