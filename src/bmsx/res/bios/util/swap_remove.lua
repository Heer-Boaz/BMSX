local function swap_remove(array, index)
	local last_index = #array
	array[index] = array[last_index]
	array[last_index] = nil
end

return swap_remove
