return function(source)
	local copy<const> = {}
	for key, value in pairs(source) do
		copy[key] = value
	end
	return copy
end
