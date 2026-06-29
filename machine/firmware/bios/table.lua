table.pack = function(...)
	local packed<const> = { n = select('#', ...) }
	for index = 1, packed.n do
		packed[index] = select(index, ...)
	end
	return packed
end

return table
