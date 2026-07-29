local clear_map<const> = function(map)
	while true do
		local key<const> = next(map)
		if key == nil then
			break
		end
		map[key] = nil
	end
end

return clear_map
