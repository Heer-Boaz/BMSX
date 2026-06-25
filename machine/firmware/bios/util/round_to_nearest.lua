return function(value)
	if value >= 0 then
		return (value + 0.5) // 1
	end
	return -(((-value) + 0.5) // 1)
end
