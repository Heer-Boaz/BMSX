table.pack = function(...)
	local packed<const> = { n = select('#', ...) }
	for index = 1, packed.n do
		packed[index] = select(index, ...)
	end
	return packed
end


table.insert = function(target, ...)
	local argc<const> = select('#', ...)
	if argc == 1 then
		target[#target + 1] = select(1, ...)
		return
	end
	local position<const> = select(1, ...) // 1
	local value<const> = select(2, ...)
	local length<const> = #target
	for index = length, position, -1 do
		target[index + 1] = target[index]
	end
	target[position] = value
end


table.remove = function(target, position_arg)
	local length<const> = #target
	local position<const> = position_arg == nil and length or position_arg // 1
	local removed<const> = target[position]
	for index = position, length - 1 do
		target[index] = target[index + 1]
	end
	target[length] = nil
	return removed
end

return table
