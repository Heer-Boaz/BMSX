// Headless IDE test: selected string library functions execute as BIOS Lua.

const lengths = t.evaluateLua(`
return string.len('abc'), string.len('áβ'), ('áβ'):len(), #'áβ'
`);
t.assert(lengths[0] === 3, `string.len ascii mismatch: ${lengths[0]}`);
t.assert(lengths[1] === 2, `string.len utf8 codepoint mismatch: ${lengths[1]}`);
t.assert(lengths[2] === 2, `string method len mismatch: ${lengths[2]}`);
t.assert(lengths[3] === 2, `string length operator mismatch: ${lengths[3]}`);

const repeated = t.evaluateLua(`
return string.rep('ab', 3), string.rep('x', 3, '-'), string.rep('x', 2.9), string.rep('x', 0), string.rep('', 3, ','), string.rep('z')
`);
t.assert(repeated[0] === 'ababab', `string.rep repeated value mismatch: ${repeated[0]}`);
t.assert(repeated[1] === 'x-x-x', `string.rep separator mismatch: ${repeated[1]}`);
t.assert(repeated[2] === 'xx', `string.rep fractional count mismatch: ${repeated[2]}`);
t.assert(repeated[3] === '', `string.rep zero count mismatch: ${repeated[3]}`);
t.assert(repeated[4] === ',,', `string.rep empty value separator mismatch: ${repeated[4]}`);
t.assert(repeated[5] === 'z', `string.rep default count mismatch: ${repeated[5]}`);
