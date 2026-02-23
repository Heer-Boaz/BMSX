local function clear_map(map)
	while true do
		local key = next(map)
		if key == nil then
			break
		end
		map[key] = nil
	end
end

return clear_map
