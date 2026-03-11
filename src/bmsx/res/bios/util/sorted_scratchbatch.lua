-- sorted_scratchbatch.lua
-- reusable scratch batch with sort support for the active window

local scratchbatch = require('scratchbatch')

local sorted_scratchbatch = {}
sorted_scratchbatch.__index = sorted_scratchbatch
setmetatable(sorted_scratchbatch, { __index = scratchbatch })

local function default_compare(left, right)
	return left < right
end

local function sort_range(items, left, right, compare)
	while left < right do
		local i = left
		local j = right
		local pivot = items[(left + right) // 2]
		while i <= j do
			while i <= right and compare(items[i], pivot) do
				i = i + 1
			end
			while j >= left and compare(pivot, items[j]) do
				j = j - 1
			end
			if i <= j then
				items[i], items[j] = items[j], items[i]
				i = i + 1
				j = j - 1
			end
		end
		if (j - left) < (right - i) then
			if left < j then
				sort_range(items, left, j, compare)
			end
			left = i
		else
			if i < right then
				sort_range(items, i, right, compare)
			end
			right = j
		end
	end
end

function sorted_scratchbatch.new(initial_capacity, fill_value, compare)
	local batch = scratchbatch.new(initial_capacity, fill_value)
	batch.compare = compare or default_compare
	return setmetatable(batch, sorted_scratchbatch)
end

function sorted_scratchbatch:set_compare(compare)
	self.compare = compare or default_compare
end

function sorted_scratchbatch:sort(compare)
	if self.size < 2 then
		return
	end
	sort_range(self.items, 1, self.size, compare or self.compare or default_compare)
end

return sorted_scratchbatch
