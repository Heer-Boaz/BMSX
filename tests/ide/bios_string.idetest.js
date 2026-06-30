// Headless IDE test: selected string library functions execute as BIOS Lua.

const lengths = t.evaluateLua(`
return string.len('abc'), string.len('áβ'), ('áβ'):len(), #'áβ'
`);
t.assert(lengths[0] === 3, `string.len ascii mismatch: ${lengths[0]}`);
t.assert(lengths[1] === 2, `string.len utf8 codepoint mismatch: ${lengths[1]}`);
t.assert(lengths[2] === 2, `string method len mismatch: ${lengths[2]}`);
t.assert(lengths[3] === 2, `string length operator mismatch: ${lengths[3]}`);
