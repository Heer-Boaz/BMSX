local set_utils = {}

function set_utils.clear_map(map)
	for key in pairs(map) do
		map[key] = nil
	end
end

return set_utils
