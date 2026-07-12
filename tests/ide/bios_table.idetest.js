// Headless IDE test: BIOS table library functions execute as guest Lua.

const packed = t.evaluateLua(`
local packed<const> = table.pack('a', nil, 3)
return packed.n, packed[1], packed[2], packed[3]
`);
t.assert(packed[0] === 3, `table.pack should preserve argument count including nil, got ${packed[0]}`);
t.assert(packed[1] === 'a', `table.pack first value mismatch: ${packed[1]}`);
t.assert(packed[2] === null, `table.pack nil slot should survive as nil/null, got ${packed[2]}`);
t.assert(packed[3] === 3, `table.pack third value mismatch: ${packed[3]}`);

const mutated = t.evaluateLua(`
local values<const> = { 'a', 'c' }
table.insert(values, 2, 'b')
table.insert(values, 'd')
local removed_middle<const> = table.remove(values, 2)
local removed_tail<const> = table.remove(values)
local empty_remove_count<const> = select('#', table.remove({}))
return values[1], values[2], removed_middle, removed_tail, empty_remove_count
`);
t.assert(mutated[0] === 'a', `table.insert/remove first value mismatch: ${mutated[0]}`);
t.assert(mutated[1] === 'c', `table.insert/remove second value mismatch: ${mutated[1]}`);
t.assert(mutated[2] === 'b', `table.remove middle value mismatch: ${mutated[2]}`);
t.assert(mutated[3] === 'd', `table.remove tail value mismatch: ${mutated[3]}`);
t.assert(mutated[4] === 1, `table.remove should return one nil value for an empty remove, got ${mutated[4]}`);

const concatenated = t.evaluateLua(`
local values<const> = { 'a', nil, 3, 'd' }
local joined<const> = table.concat(values, '-', 1, 4)
local tail<const> = table.concat({ 'a', 'b', 'c', 'd' }, '/', -2)
local empty<const> = table.concat(values, ',', 3, 2)
return joined, tail, empty
`);
t.assert(concatenated[0] === 'a--3-d', `table.concat joined range mismatch: ${concatenated[0]}`);
t.assert(concatenated[1] === 'c/d', `table.concat negative start mismatch: ${concatenated[1]}`);
t.assert(concatenated[2] === '', `table.concat empty range mismatch: ${concatenated[2]}`);

const unpacked = t.evaluateLua(`
local values<const> = { 'a', nil, 'c', 'd' }
local count<const> = select('#', table.unpack(values, 1, 4))
local second<const> = select(2, table.unpack(values, 1, 4))
local dense<const> = { 'a', 'b', 'c', 'd' }
local tail1<const>, tail2<const> = table.unpack(dense, -2)
local empty_count<const> = select('#', table.unpack(values, 3, 2))
return count, second, tail1, tail2, empty_count
`);
t.assert(unpacked[0] === 4, `table.unpack should preserve nil slots in multiple returns, got ${unpacked[0]}`);
t.assert(unpacked[1] === null, `table.unpack nil slot mismatch: ${unpacked[1]}`);
t.assert(unpacked[2] === 'c', `table.unpack negative start first mismatch: ${unpacked[2]}`);
t.assert(unpacked[3] === 'd', `table.unpack negative start second mismatch: ${unpacked[3]}`);
t.assert(unpacked[4] === 0, `table.unpack empty range should return no values, got ${unpacked[4]}`);


const sortedDefault = t.evaluateLua(`
local values<const> = { 4, 1, 3, 2 }
local return_value<const> = table.sort(values)
return values[1], values[2], values[3], values[4], return_value
`);
t.assert(sortedDefault[0] === 1, `table.sort default first mismatch: ${sortedDefault[0]}`);
t.assert(sortedDefault[1] === 2, `table.sort default second mismatch: ${sortedDefault[1]}`);
t.assert(sortedDefault[2] === 3, `table.sort default third mismatch: ${sortedDefault[2]}`);
t.assert(sortedDefault[3] === 4, `table.sort default fourth mismatch: ${sortedDefault[3]}`);
t.assert(sortedDefault[4] === null, `table.sort should not return the target table: ${sortedDefault[4]}`);

const sortedWithComparator = t.evaluateLua(`
local values<const> = { 'bb', 'dddd', 'a', 'ccc' }
table.sort(values, function(left, right)
	return #left > #right
end)
return values[1], values[2], values[3], values[4]
`);
t.assert(sortedWithComparator[0] === 'dddd', `table.sort comparator first mismatch: ${sortedWithComparator[0]}`);
t.assert(sortedWithComparator[1] === 'ccc', `table.sort comparator second mismatch: ${sortedWithComparator[1]}`);
t.assert(sortedWithComparator[2] === 'bb', `table.sort comparator third mismatch: ${sortedWithComparator[2]}`);
t.assert(sortedWithComparator[3] === 'a', `table.sort comparator fourth mismatch: ${sortedWithComparator[3]}`);

const sortedComparisonCount = t.evaluateLua(`
local values<const> = { 1, 2, 3, 4, 5, 6 }
local counter<const> = { comparisons = 0 }
table.sort(values, function(left, right)
	counter.comparisons = counter.comparisons + 1
	return left < right
end)
return counter.comparisons
`);
t.assert(sortedComparisonCount[0] === 5, `table.sort should scan an already sorted list once, got ${sortedComparisonCount[0]}`);
