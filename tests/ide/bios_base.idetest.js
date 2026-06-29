// Headless IDE test: BIOS base library functions execute as guest Lua.

const okValues = t.evaluateLua(`
return assert(0, 'kept', nil, 7)
`);
t.assert(okValues.length === 4, `assert should return all success values, got length ${okValues.length}`);
t.assert(okValues[0] === 0, `assert should return the truthy condition, got ${okValues[0]}`);
t.assert(okValues[1] === 'kept', `assert should return the second argument, got ${okValues[1]}`);
t.assert(okValues[2] === null, `assert should preserve nil vararg slots, got ${okValues[2]}`);
t.assert(okValues[3] === 7, `assert should return later varargs after nil, got ${okValues[3]}`);

const failure = t.evaluateLua(`
local ok<const>, message<const> = pcall(function() assert(false, 'bios assert failed') end)
return ok, message
`);
t.assert(failure[0] === false, 'assert(false, message) should fail under pcall');
t.assert(failure[1] === 'bios assert failed', `assert failure message mismatch: ${failure[1]}`);

const ipairsValues = t.evaluateLua(`
local values<const> = { 'first', 'second', nil, 'ignored' }
local seen<const> = {}
for index, value in ipairs(values) do
	seen[#seen + 1] = index .. ':' .. value
end
return seen[1], seen[2], seen[3]
`);
t.assert(ipairsValues[0] === '1:first', `ipairs first entry mismatch: ${ipairsValues[0]}`);
t.assert(ipairsValues[1] === '2:second', `ipairs second entry mismatch: ${ipairsValues[1]}`);
t.assert(ipairsValues[2] === null, `ipairs should stop at the first nil slot, got ${ipairsValues[2]}`);
