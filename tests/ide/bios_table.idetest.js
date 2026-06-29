// Headless IDE test: BIOS table library functions execute as guest Lua.

const packed = t.evaluateLua(`
local packed<const> = table.pack('a', nil, 3)
return packed.n, packed[1], packed[2], packed[3]
`);
t.assert(packed[0] === 3, `table.pack should preserve argument count including nil, got ${packed[0]}`);
t.assert(packed[1] === 'a', `table.pack first value mismatch: ${packed[1]}`);
t.assert(packed[2] === null, `table.pack nil slot should survive as nil/null, got ${packed[2]}`);
t.assert(packed[3] === 3, `table.pack third value mismatch: ${packed[3]}`);
