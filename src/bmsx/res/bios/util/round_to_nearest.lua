local round_to_nearest<const> = function(value)
	if value >= 0 then
		return math.floor(value + 0.5)
	end
	return -math.floor((-value) + 0.5)
end

return round_to_nearest
