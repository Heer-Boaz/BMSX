-- scratch_record_batch.lua
-- reusable scratch batch for small table-shaped records

local scratch_record_batch<const> = {}
scratch_record_batch.__index = scratch_record_batch

function scratch_record_batch.new(initial_capacity)
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
	}, scratch_record_batch)
end

function scratch_record_batch:get(index)
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

function scratch_record_batch:reserve(min_capacity)
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

return scratch_record_batch
