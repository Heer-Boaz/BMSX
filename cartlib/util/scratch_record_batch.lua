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
	}, scratch_record_batch)
end

-- disable-next-line ensure_local_alias_pattern -- this is the retained batch's high-water allocation, not an ensure wrapper.
function scratch_record_batch:get(index)
	local item = self.items[index]
	if item == nil then
		item = {}
		self.items[index] = item
	end
	return item
end

return scratch_record_batch
