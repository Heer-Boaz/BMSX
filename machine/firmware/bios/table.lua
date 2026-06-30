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


local normalize_index<const> = function(value, length, zero)
	local index<const> = value // 1
	if index > 0 then
		return index
	end
	if index < 0 then
		return length + index + 1
	end
	return zero
end

local concat_range
concat_range = function(target, separator, first, last)
	if first == last then
		local value<const> = target[first]
		if value == nil then
			return ''
		end
		return tostring(value)
	end
	local midpoint<const> = (first + last) // 2
	return concat_range(target, separator, first, midpoint) .. separator .. concat_range(target, separator, midpoint + 1, last)
end


table.concat = function(target, separator_arg, start_arg, end_arg)
	local length<const> = #target
	local start_index<const> = start_arg == nil and 1 or normalize_index(start_arg, length, 1)
	local end_index<const> = end_arg == nil and length or normalize_index(end_arg, length, length)
	if end_index < start_index then
		return ''
	end
	local separator = ''
	if separator_arg ~= nil then
		separator = tostring(separator_arg)
	end
	return concat_range(target, separator, start_index, end_index)
end


local unpack_range
unpack_range = function(target, index, last)
	if index == last then
		return target[index]
	end
	return target[index], unpack_range(target, index + 1, last)
end


table.unpack = function(target, start_arg, end_arg)
	local length<const> = #target
	local start_index<const> = start_arg == nil and 1 or normalize_index(start_arg, length, 1)
	local end_index<const> = end_arg == nil and length or normalize_index(end_arg, length, length)
	if end_index < start_index then
		return select(1)
	end
	return unpack_range(target, start_index, end_index)
end


local quicksort<const> = function(target, first, last, compare)
	while first < last do
		local pivot<const> = target[(first + last) // 2]
		local left = first
		local right = last
		while left <= right do
			if compare == nil then
				while target[left] < pivot do
					left = left + 1
				end
				while pivot < target[right] do
					right = right - 1
				end
			else
				while compare(target[left], pivot) do
					left = left + 1
				end
				while compare(pivot, target[right]) do
					right = right - 1
				end
			end
			if left <= right then
				local value<const> = target[left]
				target[left] = target[right]
				target[right] = value
				left = left + 1
				right = right - 1
			end
		end
		if right - first < last - left then
			if first < right then
				quicksort(target, first, right, compare)
			end
			first = left
		else
			if left < last then
				quicksort(target, left, last, compare)
			end
			last = right
		end
	end
end


table.sort = function(target, compare)
	local length<const> = #target
	if length > 1 then
		quicksort(target, 1, length, compare)
	end
end

return table
