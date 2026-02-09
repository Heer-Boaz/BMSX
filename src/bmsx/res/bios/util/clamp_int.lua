local function clamp_int(value, min_value, max_value)
	local clamped = value
	if clamped < min_value then
		clamped = min_value
	end
	if clamped > max_value then
		clamped = max_value
	end
	return clamped
end

return clamp_int
