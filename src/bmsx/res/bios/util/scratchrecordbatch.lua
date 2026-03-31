-- scratchrecordbatch.lua
-- reusable scratch batch for small table-shaped records

local scratchrecordbatch<const> = {}
scratchrecordbatch.__index = scratchrecordbatch

function scratchrecordbatch.new(initial_capacity)
	local items<const> = {}
	local count<const> = initial_capacity or 0
	local i = 0
	while i < count do
		i = i + 1
		items[i] = {}
	end
	return setmetatable({
		items = items,
		size = count,
		length = count,
	}, scratchrecordbatch)
end

function scratchrecordbatch:get(index)
	local item = self.items[index]
	if item == nil then
		item = {}
		self.items[index] = item
		if index > self.size then
			self.size = index
			self.length = index
		end
	end
	return item
end

function scratchrecordbatch:reserve(min_capacity)
	local items<const> = self.items
	while #items < min_capacity do
		items[#items + 1] = {}
	end
	if min_capacity > self.size then
		self.size = min_capacity
		self.length = min_capacity
	end
	return items
end

return scratchrecordbatch
