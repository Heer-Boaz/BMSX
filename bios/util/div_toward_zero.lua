local div_toward_zero<const> = function(value, divisor)
	if value >= 0 then
		return value // divisor
	end
	return -((-value) // divisor)
end

return div_toward_zero
