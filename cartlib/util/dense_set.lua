local dense_set<const> = {}

function dense_set.new()
	return {
		items = {},
		indices = {},
	}
end

function dense_set.add(set, value)
	local items<const> = set.items
	local index<const> = #items + 1
	items[index] = value
	set.indices[value] = index
end

function dense_set.remove(set, value)
	local items<const> = set.items
	local indices<const> = set.indices
	local index<const> = indices[value]
	local last_index<const> = #items
	if index < last_index then
		local moved<const> = items[last_index]
		items[index] = moved
		indices[moved] = index
	end
	items[last_index] = nil
	indices[value] = nil
end

return dense_set
