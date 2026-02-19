local function clear_map(map)
	for key in pairs(map) do
		map[key] = nil
	end
end

return clear_map
