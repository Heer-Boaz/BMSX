local clear_map<const> = function(map)
	for key in next, map do
		map[key] = nil
	end
end

return clear_map
