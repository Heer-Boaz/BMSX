local swap_remove<const> = function(array, index)
	local last_index<const> = #array
	array[index] = array[last_index]
	array[last_index] = nil
end

return swap_remove
