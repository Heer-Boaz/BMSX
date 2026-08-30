await t.waitForCart();
await t.frames(10);

t.openLuaSource('cart.lua');
t.replaceActiveCodeSource([
	'local function combine(first, second, third)',
	'\treturn first + second + third',
	'end',
	'combine(',
	'\t1,',
	'\tmath.max(2, 3),',
	'\t',
].join('\n'));
await t.frames(2);

const outer = t.signatureHelp();
t.assert(outer !== null, 'multiline user-call signature help did not open');
t.assert(outer.signatures[0].label === 'combine(first, second, third)', 'user-call signature label is wrong');
t.assert(outer.activeParameter === 2, 'outer call did not select its third argument');

t.replaceActiveCodeSource([
	'local function combine(first, second, third)',
	'\treturn first + second + third',
	'end',
	'combine(',
	'\t1,',
	'\tmath.max(2, ',
].join('\n'));
await t.frames(2);

const nested = t.signatureHelp();
t.assert(nested !== null, 'incomplete nested builtin signature help did not open');
t.assert(nested.signatures[0].label === 'math.max(first, ...)', 'firmware function signature label is wrong');
t.assert(nested.activeParameter === 1, 'nested call did not select its second argument');
