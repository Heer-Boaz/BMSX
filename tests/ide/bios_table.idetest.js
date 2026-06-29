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
