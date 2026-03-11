-- scratchbatch.lua
-- lightweight reusable scratch collections for per-frame batching

local scratchbatch = {}
scratchbatch.__index = scratchbatch

function scratchbatch.new(initial_capacity, fill_value)
	local items = {}
	local count = initial_capacity or 0
	local i = 0
	while i < count do
		i = i + 1
		items[i] = fill_value
	end
	return setmetatable({
		items = items,
		size = 0,
		length = 0,
	}, scratchbatch)
end

function scratchbatch:clear()
	self.size = 0
	self.length = 0
end

function scratchbatch:push(value)
	local next_index = self.size + 1
	self.items[next_index] = value
	self.size = next_index
	self.length = next_index
end

function scratchbatch:get(index)
	return self.items[index]
end

function scratchbatch:reserve(min_capacity, fill_value)
	local items = self.items
	while #items < min_capacity do
		items[#items + 1] = fill_value
	end
	return items
end

function scratchbatch:for_each(callback)
	for i = 1, self.size do
		callback(self.items[i], i)
	end
end

function scratchbatch:iter()
	local index = 0
	return function()
		index = index + 1
		if index <= self.size then
			return self.items[index], index
		end
	end
end

return scratchbatch
