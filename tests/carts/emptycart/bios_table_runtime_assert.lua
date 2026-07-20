__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	local packed<const> = table.pack('a', nil, 3)
	assert(packed.n == 3 and packed[1] == 'a' and packed[2] == nil and packed[3] == 3, 'table.pack mismatch')

	local values<const> = { 'a', 'c' }
	table.insert(values, 2, 'b')
	table.insert(values, 'd')
	local removed_middle<const> = table.remove(values, 2)
	local removed_tail<const> = table.remove(values)
	assert(values[1] == 'a' and values[2] == 'c', 'table.insert/remove content mismatch')
	assert(removed_middle == 'b' and removed_tail == 'd', 'table.remove result mismatch')
	assert(select('#', table.remove({})) == 1, 'empty table.remove result count mismatch')

	local concat_values<const> = { 'a', nil, 3, 'd' }
	assert(table.concat(concat_values, '-', 1, 4) == 'a--3-d', 'table.concat range mismatch')
	assert(table.concat({ 'a', 'b', 'c', 'd' }, '/', -2) == 'c/d', 'table.concat negative start mismatch')
	assert(table.concat(concat_values, ',', 3, 2) == '', 'table.concat empty range mismatch')

	local unpack_values<const> = { 'a', nil, 'c', 'd' }
	assert(select('#', table.unpack(unpack_values, 1, 4)) == 4, 'table.unpack result count mismatch')
	assert(select(2, table.unpack(unpack_values, 1, 4)) == nil, 'table.unpack nil slot mismatch')
	local tail1<const>, tail2<const> = table.unpack({ 'a', 'b', 'c', 'd' }, -2)
	assert(tail1 == 'c' and tail2 == 'd', 'table.unpack negative start mismatch')
	assert(select('#', table.unpack(unpack_values, 3, 2)) == 0, 'table.unpack empty range mismatch')

	local sorted<const> = { 4, 1, 3, 2 }
	assert(table.sort(sorted) == nil, 'table.sort return value mismatch')
	assert(sorted[1] == 1 and sorted[2] == 2 and sorted[3] == 3 and sorted[4] == 4, 'table.sort default order mismatch')

	local words<const> = { 'bb', 'dddd', 'a', 'ccc' }
	table.sort(words, function(left, right) return #left > #right end)
	assert(words[1] == 'dddd' and words[2] == 'ccc' and words[3] == 'bb' and words[4] == 'a', 'table.sort comparator order mismatch')

	local ordered<const> = { 1, 2, 3, 4, 5, 6 }
	local comparisons = 0
	table.sort(ordered, function(left, right)
		comparisons = comparisons + 1
		return left < right
	end)
	assert(comparisons == 5, 'table.sort ordered-list comparison count mismatch')
end

function __bmsx_host_test.update(_frame)
	return true
end
